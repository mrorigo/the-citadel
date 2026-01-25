import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink'; // Removed useInput
import { logger, type LogEntry } from '../../core/logger';
import { getQueue } from '../../core/queue';
import { getBeads } from '../../core/beads';
import { MoleculeTree } from './MoleculeTree';

// Simple Log Component
const LogStream = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);

    useEffect(() => {
        const handler = (entry: LogEntry) => {
            setLogs(prev => [...prev.slice(-10), entry]); // Keep last 10
        };
        logger.on('log', handler);
        return () => { logger.off('log', handler); };
    }, []);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="green" width="100%" height={15}>
            <Text bold>Live Logs</Text>
            {logs.map((l, i) => (
                <Text key={`${l.timestamp}-${i}`}>
                    <Text color="gray">[{l.timestamp.split('T')[1]?.split('.')[0] || '00:00:00'}]</Text>
                    <Text color={l.level === 'error' ? 'red' : l.level === 'warn' ? 'yellow' : 'white'}> [{l.level.toUpperCase()}] </Text>
                    {l.message}
                </Text>
            ))}
        </Box>
    );
};

// Agent Status Component
const AgentMatrix = () => {
    // In a real app, we'd listen to 'agent-state' events.
    // For now, we'll just mock it or read from DB polling? 
    // Polling is easier for mvp.
    const [activeTickets, setActiveTickets] = useState<any[]>([]);

    useEffect(() => {
        const timer = setInterval(() => {
            // This is a hacky way to get state. Ideally Conductor emits state.
            // But let's just peek at queue for now.
            // biome-ignore lint/suspicious/noExplicitAny: Quick hack
            // biome-ignore lint/suspicious/noExplicitAny: Quick hack
            const db = (getQueue() as any).db;
            // biome-ignore lint/suspicious/noExplicitAny: Quick hack
            const rows = db.query("SELECT * FROM tickets WHERE status = 'processing'").all();
            if (rows) setActiveTickets(rows as any[]);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="blue" width="50%">
            <Text bold>Active Agents</Text>
            {activeTickets.length === 0 ? <Text color="gray">No active agents</Text> : null}
            {activeTickets.map(t => (
                <Box key={t.id} flexDirection="row">
                    <Text color="cyan">{t.worker_id}</Text>
                    <Text> -&gt; </Text>
                    <Text>{t.bead_id}</Text>
                    <Text color="yellow"> ({t.status})</Text>
                </Box>
            ))}
        </Box>
    );
};

export const Dashboard = () => {
    const [status] = useState('Online');

    return (
        <Box flexDirection="column" padding={1}>
            <Box>
                <Text>The Citadel Bridge </Text>
                <Text color="green">[{status}]</Text>
            </Box>

            <Box flexDirection="row">
                <AgentMatrix />
                <MoleculeTree />
            </Box>

            <LogStream />

            <Text color="gray">Press Ctrl+C to exit</Text>
        </Box>
    );
};
