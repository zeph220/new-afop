// Pool de workers de génération avec file de priorité et annulation des tâches périmées.

import type { WorkerRequest } from '../world/world.worker.ts';

interface Job {
  id: number;
  req: WorkerRequest;
  priority: number; // plus petit = plus urgent
  stillWanted?: () => boolean;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private running = new Map<number, Job>();
  private nextId = 1;
  private dirty = false;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../world/world.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
        const job = this.running.get(e.data.id);
        this.running.delete(e.data.id);
        this.idle.push(w);
        if (job) {
          if (e.data.error) job.reject(new Error(e.data.error));
          else job.resolve(e.data.result);
        }
        this.pump();
      };
      w.onerror = (e) => console.error('Erreur worker', e.message);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  get pending(): number {
    return this.queue.length + this.running.size;
  }

  request<T>(req: WorkerRequest, priority = 0, stillWanted?: () => boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id: this.nextId++, req, priority, stillWanted, resolve: resolve as (v: unknown) => void, reject });
      this.dirty = true;
      this.pump();
    });
  }

  private pump(): void {
    if (this.dirty) {
      this.queue.sort((a, b) => a.priority - b.priority);
      this.dirty = false;
    }
    while (this.idle.length > 0 && this.queue.length > 0) {
      const job = this.queue.shift()!;
      if (job.stillWanted && !job.stillWanted()) {
        job.reject(new Error('annulé'));
        continue;
      }
      const w = this.idle.pop()!;
      this.running.set(job.id, job);
      w.postMessage({ id: job.id, req: job.req });
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    for (const j of this.queue) j.reject(new Error('arrêt'));
    this.queue = [];
  }
}
