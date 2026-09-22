import { EventEmitter } from 'node:events';
import type { ChargePointStatus } from '@volt/domain';
import { createRPCError, type IHandlersOption, RPCClient } from 'ocpp-rpc';

/** Valor de una configuration key en el simulador (GetConfiguration.conf.configurationKey). */
export interface SimulatedConfigKey {
  value: string;
  readonly: boolean;
}

export interface SimulatedChargePointOptions {
  identity: string;
  password: string | null;
  /** URL base del gateway, p. ej. `ws://127.0.0.1:9220/ocpp`; se añade `/{identity}`. */
  endpoint: string;
  vendor?: string;
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  /** Número de conectores físicos (connectorId 1..N). */
  connectors?: number;
  /** Keys que sobreescriben la configuración de fábrica del simulador. */
  configuration?: Record<string, string | SimulatedConfigKey>;
  /** ChangeConfiguration responde NotSupported para estas keys. */
  unsupportedKeys?: readonly string[];
  /** ChangeConfiguration responde RebootRequired (y aplica el valor) para estas keys. */
  rebootRequiredKeys?: readonly string[];
  /** ChangeConfiguration responde Rejected (y no aplica) para estas keys. */
  rejectedKeys?: readonly string[];
  /** Milisegundos entre el Reset aceptado y la reconexión. */
  resetDelayMs?: number;
  /** UnlockConnector responde NotSupported. */
  unlockNotSupported?: boolean;
  callTimeoutMs?: number;
  protocols?: string[];
}

export interface BootNotificationResponse {
  status: 'Accepted' | 'Pending' | 'Rejected';
  currentTime: string;
  interval: number;
}

export interface InboundCall {
  action: string;
  params: Record<string, unknown>;
  receivedAt: Date;
}

export interface SimulatedChargePointEvents {
  boot: [BootNotificationResponse];
  call: [InboundCall];
  reboot: [];
  close: [{ code?: number; reason?: string }];
  status: [{ connectorId: number; status: ChargePointStatus }];
}

/** Configuración de fábrica típica de un cargador 1.6J (valores distintos a la plantilla de Volt). */
export function factoryConfiguration(connectors: number): Record<string, SimulatedConfigKey> {
  const ro = (value: string): SimulatedConfigKey => ({ value, readonly: true });
  const rw = (value: string): SimulatedConfigKey => ({ value, readonly: false });
  return {
    NumberOfConnectors: ro(String(connectors)),
    SupportedFeatureProfiles: ro(
      'Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger',
    ),
    GetConfigurationMaxKeys: ro('100'),
    LocalAuthListMaxLength: ro('100'),
    SendLocalListMaxLength: ro('50'),
    ChargeProfileMaxStackLevel: ro('4'),
    ChargingScheduleAllowedChargingRateUnit: ro('Current,Power'),
    ChargingScheduleMaxPeriods: ro('24'),
    MaxChargingProfilesInstalled: ro('4'),
    HeartbeatInterval: rw('60'),
    WebSocketPingInterval: rw('0'),
    MeterValueSampleInterval: rw('0'),
    MeterValuesSampledData: rw('Energy.Active.Import.Register'),
    ClockAlignedDataInterval: rw('0'),
    MeterValuesAlignedData: rw(''),
    StopTxnSampledData: rw(''),
    StopTxnAlignedData: rw(''),
    ConnectionTimeOut: rw('60'),
    AuthorizeRemoteTxRequests: rw('true'),
    LocalAuthorizeOffline: rw('false'),
    LocalPreAuthorize: rw('false'),
    AllowOfflineTxForUnknownId: rw('false'),
    AuthorizationCacheEnabled: rw('false'),
    StopTransactionOnEVSideDisconnect: rw('true'),
    StopTransactionOnInvalidId: rw('true'),
    UnlockConnectorOnEVSideDisconnect: rw('true'),
    TransactionMessageAttempts: rw('3'),
    TransactionMessageRetryInterval: rw('30'),
    ResetRetries: rw('0'),
    LocalAuthListEnabled: rw('false'),
    ConnectorPhaseRotation: rw('Unknown'),
    MinimumStatusDuration: rw('0'),
    SecurityProfile: rw('1'),
  };
}

type ClientOptions = ConstructorParameters<typeof RPCClient>[0];

/**
 * Cargador OCPP 1.6J simulado. Mantiene configuración y estado de conectores en memoria y
 * responde a los comandos del CSMS (GetConfiguration, ChangeConfiguration, Reset, TriggerMessage,
 * ChangeAvailability, UnlockConnector, ClearCache). Tras un Reset aceptado se desconecta,
 * reconecta y vuelve a enviar BootNotification y StatusNotification, como un firmware real.
 */
export class SimulatedChargePoint extends EventEmitter<SimulatedChargePointEvents> {
  readonly configuration = new Map<string, SimulatedConfigKey>();
  readonly connectorStatus = new Map<number, ChargePointStatus>();
  readonly inboundCalls: InboundCall[] = [];
  /** Última AuthorizationKey recibida por ChangeConfiguration (nunca se devuelve en GetConfiguration). */
  authorizationKey: string | undefined;
  bootCount = 0;
  lastBoot: BootNotificationResponse | undefined;
  private client: RPCClient | undefined;
  private password: string | null;
  private readonly connectors: number;
  private closingForReset = false;

  constructor(private readonly options: SimulatedChargePointOptions) {
    super();
    this.connectors = options.connectors ?? 2;
    this.password = options.password;
    for (const [key, entry] of Object.entries(factoryConfiguration(this.connectors))) {
      this.configuration.set(key, entry);
    }
    for (const [key, entry] of Object.entries(options.configuration ?? {})) {
      this.configuration.set(
        key,
        typeof entry === 'string' ? { value: entry, readonly: false } : entry,
      );
    }
    for (let connectorId = 0; connectorId <= this.connectors; connectorId++) {
      this.connectorStatus.set(connectorId, 'Available');
    }
  }

  get identity(): string {
    return this.options.identity;
  }

  get connected(): boolean {
    return this.client?.state === RPCClient.OPEN;
  }

  private createClient(): RPCClient {
    const options = {
      identity: this.options.identity,
      endpoint: this.options.endpoint,
      password: this.password,
      protocols: this.options.protocols ?? ['ocpp1.6'],
      strictMode: false,
      reconnect: false,
      maxReconnects: 0,
      callTimeoutMs: this.options.callTimeoutMs ?? 5000,
    } as unknown as ClientOptions;
    const client = new RPCClient(options);
    client.handle(async ({ method, params }: IHandlersOption) =>
      this.dispatch(method ?? '', params),
    );
    client.on('close', (event: { code?: number; reason?: string } = {}) => {
      if (this.client === client) this.client = undefined;
      this.emit('close', event);
    });
    return client;
  }

  /** Abre el WebSocket con Basic Auth (usuario = identidad, contraseña = AuthorizationKey). */
  async connect(): Promise<void> {
    if (this.client && this.client.state !== RPCClient.CLOSED) {
      await this.client.close({ force: true }).catch(() => undefined);
    }
    this.client = this.createClient();
    await this.client.connect();
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client)
      await client.close({ code: 1000, reason: 'Simulator closed' }).catch(() => undefined);
  }

  /** Cambia la contraseña que se usará en la siguiente conexión (rotación de AuthorizationKey). */
  setPassword(password: string | null): void {
    this.password = password;
  }

  private requireClient(): RPCClient {
    if (!this.client || this.client.state !== RPCClient.OPEN) {
      throw new Error(`simulador ${this.options.identity} no conectado`);
    }
    return this.client;
  }

  async call<T = Record<string, unknown>>(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    return (await this.requireClient().call(action, payload)) as T;
  }

  async boot(): Promise<BootNotificationResponse> {
    const response = await this.call<BootNotificationResponse>('BootNotification', {
      chargePointVendor: this.options.vendor ?? 'VoltSim',
      chargePointModel: this.options.model ?? 'SIM-DC180',
      chargePointSerialNumber: this.options.serialNumber ?? `${this.options.identity}-SN`,
      firmwareVersion: this.options.firmwareVersion ?? '1.0.0-sim',
      meterType: 'SIM',
      meterSerialNumber: `${this.options.identity}-METER`,
    });
    this.bootCount += 1;
    this.lastBoot = response;
    if (response.status === 'Accepted' && response.interval > 0) {
      this.configuration.set('HeartbeatInterval', {
        value: String(response.interval),
        readonly: false,
      });
    }
    this.emit('boot', response);
    return response;
  }

  async heartbeat(): Promise<{ currentTime: string }> {
    return this.call('Heartbeat', {});
  }

  async sendStatus(
    connectorId: number,
    status: ChargePointStatus,
    errorCode = 'NoError',
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    this.connectorStatus.set(connectorId, status);
    await this.call('StatusNotification', {
      connectorId,
      status,
      errorCode,
      timestamp: new Date().toISOString(),
      ...extra,
    });
    this.emit('status', { connectorId, status });
  }

  /** Envía StatusNotification del cargador (0) y de cada conector con su estado actual. */
  async sendAllStatuses(): Promise<void> {
    for (let connectorId = 0; connectorId <= this.connectors; connectorId++) {
      const status = this.connectorStatus.get(connectorId) ?? 'Available';
      await this.sendStatus(connectorId, status);
    }
  }

  /** Secuencia típica de arranque: conectar, BootNotification y estados. */
  async start(): Promise<BootNotificationResponse> {
    await this.connect();
    const boot = await this.boot();
    if (boot.status !== 'Rejected') await this.sendAllStatuses();
    return boot;
  }

  /** Espera la siguiente CALL entrante con esa acción (o falla al vencer el plazo). */
  waitForCall(action: string, timeoutMs = 5000): Promise<InboundCall> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('call', listener);
        reject(new Error(`no llegó ${action} en ${timeoutMs} ms`));
      }, timeoutMs);
      const listener = (call: InboundCall) => {
        if (call.action !== action) return;
        clearTimeout(timer);
        this.off('call', listener);
        resolve(call);
      };
      this.on('call', listener);
    });
  }

  /** Espera a que el simulador haya reconectado y arrancado tras un Reset. */
  waitForReboot(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sin reboot en el plazo')), timeoutMs);
      this.once('reboot', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async dispatch(
    action: string,
    rawParams: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown>> {
    const params = rawParams ?? {};
    const call: InboundCall = { action, params, receivedAt: new Date() };
    this.inboundCalls.push(call);
    this.emit('call', call);
    switch (action) {
      case 'GetConfiguration':
        return this.getConfiguration(params);
      case 'ChangeConfiguration':
        return this.changeConfiguration(params);
      case 'Reset':
        return this.reset();
      case 'TriggerMessage':
        return this.triggerMessage(params);
      case 'ChangeAvailability':
        return this.changeAvailability(params);
      case 'UnlockConnector':
        return { status: this.options.unlockNotSupported ? 'NotSupported' : 'Unlocked' };
      case 'ClearCache':
        return { status: 'Accepted' };
      case 'RemoteStartTransaction':
      case 'RemoteStopTransaction':
        return { status: 'Rejected' };
      default:
        throw createRPCError('NotImplemented', `El simulador no implementa ${action}`);
    }
  }

  private getConfiguration(params: Record<string, unknown>): Record<string, unknown> {
    const requested = Array.isArray(params.key) ? (params.key as string[]) : undefined;
    const configurationKey: { key: string; readonly: boolean; value?: string }[] = [];
    const unknownKey: string[] = [];
    const keys = requested ?? [...this.configuration.keys()];
    for (const key of keys) {
      const entry = this.configuration.get(key);
      if (!entry) {
        unknownKey.push(key);
        continue;
      }
      configurationKey.push({ key, readonly: entry.readonly, value: entry.value });
    }
    return { configurationKey, unknownKey };
  }

  private changeConfiguration(params: Record<string, unknown>): Record<string, unknown> {
    const key = String(params.key ?? '');
    const value = String(params.value ?? '');
    if (key === 'AuthorizationKey') {
      // Clave de solo escritura (SEG §2.2): se guarda para la próxima conexión y nunca se lista.
      this.authorizationKey = value;
      return { status: 'Accepted' };
    }
    if (this.options.unsupportedKeys?.includes(key)) return { status: 'NotSupported' };
    if (this.options.rejectedKeys?.includes(key)) return { status: 'Rejected' };
    const entry = this.configuration.get(key);
    if (!entry) return { status: 'NotSupported' };
    if (entry.readonly) return { status: 'Rejected' };
    this.configuration.set(key, { value, readonly: false });
    if (this.options.rebootRequiredKeys?.includes(key)) return { status: 'RebootRequired' };
    return { status: 'Accepted' };
  }

  private reset(): Record<string, unknown> {
    if (this.closingForReset) return { status: 'Rejected' };
    this.closingForReset = true;
    const delay = this.options.resetDelayMs ?? 200;
    setTimeout(() => {
      void (async () => {
        try {
          await this.close();
          await new Promise((resolve) => setTimeout(resolve, delay));
          await this.start();
          this.emit('reboot');
        } catch {
          // El gateway puede haberse detenido; el simulador queda desconectado.
        } finally {
          this.closingForReset = false;
        }
      })();
    }, 20);
    return { status: 'Accepted' };
  }

  private triggerMessage(params: Record<string, unknown>): Record<string, unknown> {
    const requested = String(params.requestedMessage ?? '');
    const connectorId =
      typeof params.connectorId === 'number' ? (params.connectorId as number) : undefined;
    const after = (task: () => Promise<unknown>) => {
      setTimeout(() => void task().catch(() => undefined), 10);
    };
    switch (requested) {
      case 'BootNotification':
        after(() => this.boot());
        return { status: 'Accepted' };
      case 'Heartbeat':
        after(() => this.heartbeat());
        return { status: 'Accepted' };
      case 'StatusNotification':
        after(() =>
          connectorId === undefined
            ? this.sendAllStatuses()
            : this.sendStatus(connectorId, this.connectorStatus.get(connectorId) ?? 'Available'),
        );
        return { status: 'Accepted' };
      case 'MeterValues':
      case 'DiagnosticsStatusNotification':
      case 'FirmwareStatusNotification':
        return { status: 'NotImplemented' };
      default:
        return { status: 'Rejected' };
    }
  }

  private changeAvailability(params: Record<string, unknown>): Record<string, unknown> {
    const connectorId = Number(params.connectorId ?? 0);
    const target: ChargePointStatus = params.type === 'Inoperative' ? 'Unavailable' : 'Available';
    const ids =
      connectorId === 0
        ? [...this.connectorStatus.keys()]
        : this.connectorStatus.has(connectorId)
          ? [connectorId]
          : [];
    if (ids.length === 0) return { status: 'Rejected' };
    setTimeout(() => {
      void (async () => {
        for (const id of ids) await this.sendStatus(id, target).catch(() => undefined);
      })();
    }, 10);
    return { status: 'Accepted' };
  }
}
