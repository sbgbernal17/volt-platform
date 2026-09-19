/** Quién inicia el mensaje: el cargador (CP) o el sistema central (CS). */
export type Initiator = 'CP' | 'CS';

export type FeatureProfile =
  | 'Core'
  | 'FirmwareManagement'
  | 'LocalAuthListManagement'
  | 'Reservation'
  | 'SmartCharging'
  | 'RemoteTrigger'
  | 'Security';

export interface ActionMeta {
  readonly action: string;
  readonly initiators: readonly Initiator[];
  readonly profile: FeatureProfile;
}

const core = (action: string, initiators: readonly Initiator[]): ActionMeta => ({
  action,
  initiators,
  profile: 'Core',
});
const meta = (
  action: string,
  initiators: readonly Initiator[],
  profile: FeatureProfile,
): ActionMeta => ({ action, initiators, profile });

/** Catálogo completo de acciones de OCPP 1.6J, incluido el Security Whitepaper (3.ª ed.). */
export const OCPP16_ACTIONS: readonly ActionMeta[] = [
  core('Authorize', ['CP']),
  core('BootNotification', ['CP']),
  core('ChangeAvailability', ['CS']),
  core('ChangeConfiguration', ['CS']),
  core('ClearCache', ['CS']),
  core('DataTransfer', ['CP', 'CS']),
  core('GetConfiguration', ['CS']),
  core('Heartbeat', ['CP']),
  core('MeterValues', ['CP']),
  core('RemoteStartTransaction', ['CS']),
  core('RemoteStopTransaction', ['CS']),
  core('Reset', ['CS']),
  core('StartTransaction', ['CP']),
  core('StatusNotification', ['CP']),
  core('StopTransaction', ['CP']),
  core('UnlockConnector', ['CS']),
  meta('GetDiagnostics', ['CS'], 'FirmwareManagement'),
  meta('DiagnosticsStatusNotification', ['CP'], 'FirmwareManagement'),
  meta('FirmwareStatusNotification', ['CP'], 'FirmwareManagement'),
  meta('UpdateFirmware', ['CS'], 'FirmwareManagement'),
  meta('GetLocalListVersion', ['CS'], 'LocalAuthListManagement'),
  meta('SendLocalList', ['CS'], 'LocalAuthListManagement'),
  meta('CancelReservation', ['CS'], 'Reservation'),
  meta('ReserveNow', ['CS'], 'Reservation'),
  meta('ClearChargingProfile', ['CS'], 'SmartCharging'),
  meta('GetCompositeSchedule', ['CS'], 'SmartCharging'),
  meta('SetChargingProfile', ['CS'], 'SmartCharging'),
  meta('TriggerMessage', ['CS'], 'RemoteTrigger'),
  meta('CertificateSigned', ['CS'], 'Security'),
  meta('DeleteCertificate', ['CS'], 'Security'),
  meta('ExtendedTriggerMessage', ['CS'], 'Security'),
  meta('GetInstalledCertificateIds', ['CS'], 'Security'),
  meta('GetLog', ['CS'], 'Security'),
  meta('InstallCertificate', ['CS'], 'Security'),
  meta('LogStatusNotification', ['CP'], 'Security'),
  meta('SecurityEventNotification', ['CP'], 'Security'),
  meta('SignCertificate', ['CP'], 'Security'),
  meta('SignedFirmwareStatusNotification', ['CP'], 'Security'),
  meta('SignedUpdateFirmware', ['CS'], 'Security'),
];

const BY_NAME = new Map(OCPP16_ACTIONS.map((m) => [m.action, m]));

export function getActionMeta(action: string): ActionMeta | undefined {
  return BY_NAME.get(action);
}

export function isKnownAction(action: string): boolean {
  return BY_NAME.has(action);
}

/** Acciones que un cargador puede enviar al CSMS (CALL entrante). */
export function isChargePointInitiated(action: string): boolean {
  return BY_NAME.get(action)?.initiators.includes('CP') ?? false;
}

/** Acciones que el CSMS puede enviar a un cargador (CALL saliente). */
export function isCentralSystemInitiated(action: string): boolean {
  return BY_NAME.get(action)?.initiators.includes('CS') ?? false;
}
