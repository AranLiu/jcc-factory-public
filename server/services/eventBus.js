const { randomUUID } = require('node:crypto');

function createEventBus({ heartbeatMs = 30_000, maxClientsPerUser = 3 } = {}) {
    const clients = new Map();

    function addClient(res, meta = {}) {
        if (!meta.userId) throw new Error('Authenticated user metadata is required');
        const currentCount = [...clients.values()].filter(client => client.meta.userId === meta.userId).length;
        if (currentCount >= maxClientsPerUser) throw new Error('SSE connection limit exceeded');

        const id = `sse_${randomUUID()}`;
        clients.set(id, { res, meta });
        res.write('event: ping\n');
        res.write('data: {"hello":true}\n\n');
        return id;
    }

    function removeClient(id) {
        const client = clients.get(id);
        if (!client) return;
        try { client.res.end(); } catch (_) {}
        clients.delete(id);
    }

    function send(client, event, payload) {
        const data = JSON.stringify(payload);
        client.res.write(`event: ${event}\n`);
        client.res.write(`data: ${data}\n\n`);
    }

    function broadcast(event, payload) {
        if (!payload?.userId) return 0;
        let delivered = 0;
        for (const [id, client] of clients.entries()) {
            if (client.meta.role !== 'admin' && client.meta.userId !== payload.userId) continue;
            try {
                send(client, event, payload);
                delivered += 1;
            } catch (_) {
                removeClient(id);
            }
        }
        return delivered;
    }

    const heartbeat = heartbeatMs > 0 ? setInterval(() => {
        for (const [id, client] of clients.entries()) {
            try { client.res.write(': heartbeat\n\n'); } catch (_) { removeClient(id); }
        }
    }, heartbeatMs) : null;
    heartbeat?.unref?.();

    function close() {
        if (heartbeat) clearInterval(heartbeat);
        for (const id of [...clients.keys()]) removeClient(id);
    }

    return { addClient, broadcast, close, removeClient };
}

const eventBus = createEventBus();
module.exports = eventBus;
module.exports.createEventBus = createEventBus;
