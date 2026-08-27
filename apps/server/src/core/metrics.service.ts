import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly sessionsCreated = new Counter({
    name: 'persona_sessions_created_total',
    help: 'Anonymous sessions created since boot',
    registers: [this.registry],
  });

  private readonly matchesMade = new Counter({
    name: 'persona_matches_total',
    help: 'Successful random/nearby pairings',
    labelNames: ['source'],
    registers: [this.registry],
  });

  private readonly messagesRelayed = new Counter({
    name: 'persona_messages_relayed_total',
    help: 'Chat messages relayed (ciphertext only)',
    registers: [this.registry],
  });

  private readonly reportsReceived = new Counter({
    name: 'persona_reports_total',
    help: 'Abuse reports received',
    labelNames: ['category'],
    registers: [this.registry],
  });

  private readonly messageSize = new Histogram({
    name: 'persona_message_bytes',
    help: 'Chat message envelope size in bytes',
    buckets: [256, 1024, 4096, 8192, 16384],
    registers: [this.registry],
  });

  private readonly activeSessions = new Gauge({
    name: 'persona_active_sessions',
    help: 'Currently active anonymous sessions',
    registers: [this.registry],
  });

  private readonly activeRooms = new Gauge({
    name: 'persona_active_rooms',
    help: 'Currently active chat rooms',
    registers: [this.registry],
  });

  private readonly queueSize = new Gauge({
    name: 'persona_match_queue_size',
    help: 'Sessions waiting in the matching queue',
    labelNames: ['kind'],
    registers: [this.registry],
  });

  recordSessionCreated(): void {
    this.sessionsCreated.inc();
  }

  setSessionsActive(n: number): void {
    this.activeSessions.set(n);
  }

  setRoomsActive(n: number): void {
    this.activeRooms.set(n);
  }

  setQueueSize(kind: string, n: number): void {
    this.queueSize.set({ kind }, n);
  }

  recordMatch(source: string): void {
    this.matchesMade.inc({ source });
  }

  recordMessage(bytes: number): void {
    this.messagesRelayed.inc();
    this.messageSize.observe(bytes);
  }

  recordReport(category: string): void {
    this.reportsReceived.inc({ category });
  }

  async collect(): Promise<string> {
    return this.registry.metrics();
  }
}
