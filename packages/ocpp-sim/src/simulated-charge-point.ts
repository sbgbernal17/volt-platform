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
  /** Potencia de carga simulada por conector (W). */
  chargingPowerW?: number;
  /** Intervalo entre MeterValues durante una transacción (ms). */
  meterValueIntervalMs?: number;
  /** Tiempo entre RemoteStartTransaction aceptado y el enchufado del vehículo (ms). */
  plugDelayMs?: number;
  /** Lectura inicial del medidor (Wh). */
  initialMeterWh?: number;
}

export interface SimulatedTransaction {
  connectorId: number;
  idTag: string;
  /** transactionId asignado por el CSMS; negativo mientras el arranque está encolado offline. */
  transactionId: number;
  meterStartWh: number;
  startedAt: Date;
  timer?: NodeJS.Timeout | undefined;
}

interface QueuedMessage {
  action: 'StartTransaction' | 'MeterValues' | 'StopTransaction';
  payload: Record<string, unknown>;
  /** id local (negativo) que se sustituye por el real al recibir StartTransaction.conf. */
  localTransactionId?: number | undefined;
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
  transactionStarted: [SimulatedTransaction & { idTagStatus: string }];
  transactionStopped: [
    { connectorId: number; transactionId: number; meterStopWh: number; reason: string },
  ];
  meterValues: [{ connectorId: number; transactionId: number; registerWh: number }];
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
  /** Transacciones en curso por conector. */
  readonly transactions = new Map<number, SimulatedTransaction>();
  /** Registro de energía por conector (Wh). */
  readonly meterWh = new Map<number, number>();
  /** Mensajes de transacción encolados mientras el cargador está sin conexión. */
  readonly offlineQueue: QueuedMessage[] = [];
  /** Último payload enviado por acción (para simular reintentos). */
  readonly lastSent = new Map<string, Record<string, unknown>>();
  offline = false;
  private client: RPCClient | undefined;
  private password: string | null;
  private endpoint: string;
  private readonly connectors: number;
  private closingForReset = false;
  private localTransactionSeq = 0;

  constructor(private readonly options: SimulatedChargePointOptions) {
    super();
    this.connectors = options.connectors ?? 2;
    this.password = options.password;
    this.endpoint = options.endpoint;
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
      this.meterWh.set(connectorId, options.initialMeterWh ?? 12_000);
    }
  }

  /** Cambia el gateway al que se conecta (caída de pod, migración). */
  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
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
      endpoint: this.endpoint,
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
    for (const transaction of this.transactions.values()) {
      if (transaction.timer && !this.offline) {
        clearInterval(transaction.timer);
        transaction.timer = undefined;
      }
    }
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
    this.lastSent.set(action, payload);
    return (await this.requireClient().call(action, payload)) as T;
  }

  /** Vuelve a enviar el último mensaje de esa acción (reintento tras no recibir la respuesta). */
  async resend<T = Record<string, unknown>>(action: string): Promise<T> {
    const payload = this.lastSent.get(action);
    if (!payload) throw new Error(`no hay ningún ${action} previo`);
    return (await this.requireClient().call(action, payload)) as T;
  }

  /**
   * Corta la conexión. Mientras esté offline, los mensajes de transacción se encolan con su sello
   * de tiempo original y se reenvían en orden al volver (comportamiento verificado de 1.6, FUN M04).
   */
  async goOffline(): Promise<void> {
    this.offline = true;
    for (const transaction of this.transactions.values()) {
      if (transaction.timer) {
        clearInterval(transaction.timer);
        transaction.timer = undefined;
      }
    }
    await this.close();
  }

  /** Reconecta, vuelve a arrancar y reenvía la cola offline en orden cronológico. */
  async goOnline(): Promise<BootNotificationResponse> {
    this.offline = false;
    const boot = await this.start();
    await this.flushOfflineQueue();
    for (const transaction of this.transactions.values()) {
      if (!transaction.timer && transaction.transactionId > 0) this.startMeterValues(transaction);
    }
    return boot;
  }

  /** Genera un MeterValues "encolado" con un sello de tiempo dado, sin enviarlo (pruebas de corte). */
  recordOfflineSample(connectorId: number, at: Date, energyDeltaWh: number): void {
    const transaction = this.transactions.get(connectorId);
    if (!transaction) throw new Error('sin transacción en el conector');
    const register = (this.meterWh.get(connectorId) ?? 0) + energyDeltaWh;
    this.meterWh.set(connectorId, register);
    this.offlineQueue.push({
      action: 'MeterValues',
      payload: {
        connectorId,
        transactionId: transaction.transactionId,
        meterValue: [
          {
            timestamp: at.toISOString(),
            sampledValue: [
              { value: String(register), measurand: 'Energy.Active.Import.Register', unit: 'Wh' },
            ],
          },
        ],
      },
      localTransactionId: transaction.transactionId < 0 ? transaction.transactionId : undefined,
    });
  }

  private async flushOfflineQueue(): Promise<void> {
    const idMap = new Map<number, number>();
    while (this.offlineQueue.length > 0) {
      const message = this.offlineQueue.shift() as QueuedMessage;
      const payload = { ...message.payload };
      if (typeof payload.transactionId === 'number' && payload.transactionId < 0) {
        const real = idMap.get(payload.transactionId);
        if (real !== undefined) payload.transactionId = real;
      }
      const response = await this.call<Record<string, unknown>>(message.action, payload);
      if (message.action === 'StartTransaction' && message.localTransactionId !== undefined) {
        const real = Number(response.transactionId);
        idMap.set(message.localTransactionId, real);
        const transaction = this.transactions.get(Number(payload.connectorId));
        if (transaction && transaction.transactionId === message.localTransactionId)
          transaction.transactionId = real;
      }
    }
  }

  // ---- transacciones ----

  async authorize(idTag: string): Promise<{ idTagInfo: { status: string } }> {
    return this.call('Authorize', { idTag });
  }

  /**
   * Arranque de transacción (local o tras RemoteStart): StartTransaction, estado Charging y
   * MeterValues periódicos. Con idTagInfo distinto de Accepted la transacción se detiene
   * (StopTransactionOnInvalidId = true).
   */
  async startTransaction(
    connectorId: number,
    idTag: string,
    at: Date = new Date(),
  ): Promise<SimulatedTransaction & { idTagStatus: string }> {
    if (this.transactions.has(connectorId))
      throw new Error(`el conector ${connectorId} ya tiene transacción`);
    const meterStartWh = this.meterWh.get(connectorId) ?? 0;
    const startedAt = at;
    const payload = {
      connectorId,
      idTag,
      meterStart: meterStartWh,
      timestamp: startedAt.toISOString(),
    };
    const transaction: SimulatedTransaction = {
      connectorId,
      idTag,
      transactionId: 0,
      meterStartWh,
      startedAt,
    };
    this.transactions.set(connectorId, transaction);
    let idTagStatus = 'Accepted';
    if (this.offline) {
      this.localTransactionSeq += 1;
      transaction.transactionId = -this.localTransactionSeq;
      this.offlineQueue.push({
        action: 'StartTransaction',
        payload,
        localTransactionId: transaction.transactionId,
      });
      this.connectorStatus.set(connectorId, 'Charging');
    } else {
      const response = await this.call<{ transactionId: number; idTagInfo: { status: string } }>(
        'StartTransaction',
        payload,
      );
      transaction.transactionId = response.transactionId;
      idTagStatus = response.idTagInfo.status;
      if (idTagStatus !== 'Accepted') {
        await this.sendStatus(connectorId, 'Finishing');
        await this.stopTransaction(connectorId, 'DeAuthorized');
        await this.sendStatus(connectorId, 'Available');
        return { ...transaction, idTagStatus };
      }
      await this.sendStatus(connectorId, 'Charging');
      this.startMeterValues(transaction);
    }
    this.emit('transactionStarted', { ...transaction, idTagStatus });
    return { ...transaction, idTagStatus };
  }

  /** Envía un MeterValues de la transacción con el registro actual (más la energía de este intervalo). */
  async sendMeterValues(connectorId: number, energyDeltaWh = 0): Promise<void> {
    const transaction = this.transactions.get(connectorId);
    if (!transaction) return;
    const register = (this.meterWh.get(connectorId) ?? 0) + energyDeltaWh;
    this.meterWh.set(connectorId, register);
    const powerW = this.options.chargingPowerW ?? 22_000;
    const payload = {
      connectorId,
      transactionId: transaction.transactionId,
      meterValue: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: [
            {
              value: String(register),
              measurand: 'Energy.Active.Import.Register',
              unit: 'Wh',
              context: 'Sample.Periodic',
            },
            { value: String(powerW), measurand: 'Power.Active.Import', unit: 'W' },
            {
              value: String(
                Math.min(100, 20 + Math.round((register - transaction.meterStartWh) / 500)),
              ),
              measurand: 'SoC',
              unit: 'Percent',
            },
          ],
        },
      ],
    };
    if (this.offline) {
      this.offlineQueue.push({
        action: 'MeterValues',
        payload,
        localTransactionId: transaction.transactionId < 0 ? transaction.transactionId : undefined,
      });
    } else {
      await this.call('MeterValues', payload);
    }
    this.emit('meterValues', {
      connectorId,
      transactionId: transaction.transactionId,
      registerWh: register,
    });
  }

  async stopTransaction(
    connectorId: number,
    reason = 'Local',
    at: Date = new Date(),
  ): Promise<{ transactionId: number; meterStopWh: number }> {
    const transaction = this.transactions.get(connectorId);
    if (!transaction) throw new Error(`el conector ${connectorId} no tiene transacción`);
    if (transaction.timer) clearInterval(transaction.timer);
    this.transactions.delete(connectorId);
    const meterStopWh = this.meterWh.get(connectorId) ?? 0;
    const payload = {
      transactionId: transaction.transactionId,
      meterStop: meterStopWh,
      timestamp: at.toISOString(),
      reason,
      idTag: transaction.idTag,
      transactionData: [
        {
          timestamp: at.toISOString(),
          sampledValue: [
            {
              value: String(meterStopWh),
              measurand: 'Energy.Active.Import.Register',
              unit: 'Wh',
              context: 'Transaction.End',
            },
          ],
        },
      ],
    };
    if (this.offline) {
      this.offlineQueue.push({
        action: 'StopTransaction',
        payload,
        localTransactionId: transaction.transactionId < 0 ? transaction.transactionId : undefined,
      });
      this.connectorStatus.set(connectorId, 'Available');
    } else {
      await this.call('StopTransaction', payload);
    }
    this.emit('transactionStopped', {
      connectorId,
      transactionId: transaction.transactionId,
      meterStopWh,
      reason,
    });
    return { transactionId: transaction.transactionId, meterStopWh };
  }

  private startMeterValues(transaction: SimulatedTransaction): void {
    const intervalMs = this.options.meterValueIntervalMs ?? 60_000;
    const powerW = this.options.chargingPowerW ?? 22_000;
    const deltaWh = Math.max(1, Math.round((powerW * intervalMs) / 3_600_000));
    transaction.timer = setInterval(() => {
      void this.sendMeterValues(transaction.connectorId, deltaWh).catch(() => undefined);
    }, intervalMs);
    transaction.timer.unref();
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
        return this.remoteStart(params);
      case 'RemoteStopTransaction':
        return this.remoteStop(params);
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

  private remoteStart(params: Record<string, unknown>): Record<string, unknown> {
    const connectorId = typeof params.connectorId === 'number' ? params.connectorId : 1;
    const idTag = String(params.idTag ?? '');
    const status = this.connectorStatus.get(connectorId);
    if (
      !this.connectorStatus.has(connectorId) ||
      this.transactions.has(connectorId) ||
      (status !== 'Available' && status !== 'Preparing')
    ) {
      return { status: 'Rejected' };
    }
    setTimeout(() => {
      void (async () => {
        try {
          await this.sendStatus(connectorId, 'Preparing');
          await new Promise((resolve) => setTimeout(resolve, this.options.plugDelayMs ?? 50));
          await this.startTransaction(connectorId, idTag);
        } catch {
          // Gateway detenido o conexión cerrada: la sesión quedará en STARTING hasta su plazo.
        }
      })();
    }, 10);
    return { status: 'Accepted' };
  }

  private remoteStop(params: Record<string, unknown>): Record<string, unknown> {
    const transactionId = Number(params.transactionId);
    const entry = [...this.transactions.values()].find((t) => t.transactionId === transactionId);
    if (!entry) return { status: 'Rejected' };
    setTimeout(() => {
      void (async () => {
        try {
          await this.sendStatus(entry.connectorId, 'Finishing');
          await this.stopTransaction(entry.connectorId, 'Remote');
          await this.sendStatus(entry.connectorId, 'Available');
        } catch {
          // idem
        }
      })();
    }, 10);
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
