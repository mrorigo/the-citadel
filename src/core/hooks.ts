import { getQueue, type Ticket, type WorkQueue } from './queue';


export type TicketHandler = (ticket: Ticket) => Promise<void>;

export class Hook {
    private agentId: string;
    private queue: WorkQueue;
    private handler: TicketHandler;
    private pollingInterval: number = 1000;
    private isRunning: boolean = false;
    // private currentTicketId: string | null = null;
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
            try {
                await this.cycle();
            } catch (error) {
                console.error(`Hook ${this.agentId} error in loop:`, error);
            }

            if (this.isRunning) {
                // Adaptive polling: sleep if no work? 
                // For now simple fixed sleep.
                await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
            }
        }
    }

    private async cycle() {
        // 1. Claim ticket
        // AgentId is currently used as the 'assigneeId'.
        // We need to know WHICH role this hook is acting as to claim the right ticket.
        // The current implementation assumes agentId implies role or is generic.
        // We should explicitly pass role to Hook constructor.
        // For now, let's assume agentId is like 'worker-1' and we need 'worker' role.
        // OR we update hook constructor as planned.

        // I will use a simple heuristic or update constructor.
        // Let's update constructor to take `role` parameter.
        // Wait, changing constructor breaks existing usage code (tests).
        // I'll update the constructor in a separate call then.
        // For this call, I'll temporarily infer role or break.
        // Actually, let's rely on constructor update.

        // Let's defer this edit until I update the constructor definition.
        // I will skip this file edit for now and combine it.
        const ticket = this.queue.claim(this.agentId, this.role);
        if (!ticket) return; // No work



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
            // Logic to determine permanent vs temporary failure could be injected, but assuming retryable for now
            // or check error type.
            // For simplicity: retryable.
            this.queue.fail(ticket.id, false);
        } finally {
            this.stopHeartbeat();

        }
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
