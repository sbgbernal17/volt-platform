import type { OutboxRow } from '@volt/csms';
import type { EventPublisher } from './outbox-relay.ts';

/** Devuelve un token de acceso de Google válido (cuenta de servicio del entorno). */
export type TokenSource = () => Promise<string>;

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/**
 * Token de la cuenta de servicio de Cloud Run/GKE desde el servidor de metadatos, con caché hasta
 * un minuto antes de vencer. Sin dependencias: evita empaquetar el SDK de Google en la imagen.
 */
export function metadataTokenSource(fetchImpl: typeof fetch = fetch): TokenSource {
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    const response = await fetchImpl(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (!response.ok) {
      throw new Error(`servidor de metadatos respondió ${response.status}`);
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  };
}

/** Máximo de mensajes por llamada a publish (el límite de Pub/Sub es 1.000 y 10 MB). */
const BATCH = 200;

/**
 * Publica los eventos del outbox en un topic de Pub/Sub por la API REST (ARQ §2.2): el sobre del
 * evento va como `data` (JSON) y `type`, `tenantId`, `aggregateType`, `aggregateId` y `eventId`
 * como atributos para filtrar suscripciones.
 */
export class PubSubEventPublisher implements EventPublisher {
  constructor(
    /** `projects/<id>/topics/<nombre>` */
    private readonly topic: string,
    private readonly tokenSource: TokenSource = metadataTokenSource(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = 'https://pubsub.googleapis.com/v1',
  ) {}

  async publish(events: OutboxRow[]): Promise<void> {
    for (let i = 0; i < events.length; i += BATCH) {
      const slice = events.slice(i, i + BATCH);
      const token = await this.tokenSource();
      const response = await this.fetchImpl(`${this.endpoint}/${this.topic}:publish`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: slice.map((event) => ({
            data: Buffer.from(JSON.stringify(event.payload)).toString('base64'),
            attributes: {
              type: event.type,
              tenantId: event.tenant_id,
              aggregateType: event.aggregate_type,
              aggregateId: event.aggregate_id,
              eventId: event.event_id,
            },
          })),
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Pub/Sub respondió ${response.status} al publicar: ${text.slice(0, 200)}`);
      }
    }
  }
}

/** Publica en varios destinos (Redis para los consumidores locales y Pub/Sub para la telemetría). */
export class CompositeEventPublisher implements EventPublisher {
  constructor(private readonly publishers: readonly EventPublisher[]) {}

  async publish(events: OutboxRow[]): Promise<void> {
    for (const publisher of this.publishers) await publisher.publish(events);
  }
}
