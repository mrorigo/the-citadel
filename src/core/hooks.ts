import { getQueue, type Ticket, type WorkQueue } from './queue';


export type TicketHandler = (ticket: Ticket) => Promise<void>;

export class Hook {
    private agentId: string;
    private queue: WorkQueue;
    private handler: TicketHandler;
    private pollingInterval: number = 1000;
    private isRunning: boolean = false;
    private heartbeatTimer: Timer | null = null;

    private role: string;

    constructor(agentId: string, role: string, handler: TicketHandler, queue?: WorkQueue) {
        this.agentId = agentId;
        this.role = role;
        this.handler = handler;
        this.queue = queue || getQueue();
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.loop();
    }

    stop() {
        this.isRunning = false;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private async loop() {
        while (this.isRunning) {
            let processed = false;
            try {
                processed = await this.cycle();
            } catch (error) {
                console.error(`Hook ${this.agentId} error in loop:`, error);
            }

            if (this.isRunning) {
                // Adaptive polling: if we found work, check again sooner.
                // If no work, wait the full polling interval.
                const delay = processed ? 0 : this.pollingInterval;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    private async cycle(): Promise<boolean> {
        // 1. Claim ticket
        const ticket = this.queue.claim(this.agentId, this.role);
        if (!ticket) return false; // No work

        // 2. Start heartbeat
        this.startHeartbeat(ticket.id);

        try {
            // 3. Execute handler
            await this.handler(ticket);

            // 4. Mark complete
            this.queue.complete(ticket.id);
        } catch (error) {
            console.error(`Hook ${this.agentId} task failed:`, error);
            // 5. Mark failed
            this.queue.fail(ticket.id, false);
        } finally {
            this.stopHeartbeat();
        }

        return true;
    }

    private startHeartbeat(ticketId: string) {
        // Heartbeat every 10s (assuming 300s timeout)
        this.heartbeatTimer = setInterval(() => {
            try {
                this.queue.heartbeat(ticketId);
            } catch (e) {
                console.error(`Hook ${this.agentId} heartbeat failed:`, e);
            }
        }, 10000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}
