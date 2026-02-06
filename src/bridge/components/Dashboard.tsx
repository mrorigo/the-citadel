import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { getConfig } from "../../config";
import { type LogEntry, logger } from "../../core/logger";
import { getQueue, type Ticket } from "../../core/queue";
import { MoleculeTree } from "./MoleculeTree";

// Simple Log Component
const LogStream = () => {
	const config = getConfig();
	const maxLogs = config.bridge?.maxLogs || 1000;

	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [scrollTop, setScrollTop] = useState(0); // 0 means "at bottom" (showing latest)
	// >0 means scrolled UP by N lines from bottom
	const [viewHeight, _setViewHeight] = useState(15);

	useEffect(() => {
		const handler = (entry: LogEntry) => {
			setLogs((prev) => {
				const updated = [...prev, entry];
				if (updated.length > maxLogs) {
					return updated.slice(updated.length - maxLogs);
				}
				return updated;
			});
		};
		logger.on("log", handler);
		return () => {
			logger.off("log", handler);
		};
	}, [maxLogs]);

	useInput((_input, key) => {
		if (key.upArrow) {
			setScrollTop((prev) =>
				Math.min(prev + 1, Math.max(0, logs.length - viewHeight)),
			);
		}
		if (key.downArrow) {
			setScrollTop((prev) => Math.max(0, prev - 1));
		}
		if (key.pageUp) {
			setScrollTop((prev) =>
				Math.min(prev + 10, Math.max(0, logs.length - viewHeight)),
			);
		}
		if (key.pageDown) {
			setScrollTop((prev) => Math.max(0, prev - 10));
		}
	});

	// Calculate view slice
	// logs[length-1] is newest.
	// We want to show lines from (length - viewHeight - scrollTop) to (length - scrollTop)
	const total = logs.length;
	const effectiveHeight = Math.min(total, viewHeight);

	// Start index (inclusive)
	// If scrollTop=0, start = total - effectiveHeight
	// If scrollTop=1, start = total - effectiveHeight - 1
	let startIndex = total - effectiveHeight - scrollTop;
	if (startIndex < 0) startIndex = 0;

	// End index (exclusive)
	const endIndex = startIndex + effectiveHeight;

	const viewLogs = logs.slice(startIndex, endIndex);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={scrollTop > 0 ? "yellow" : "green"}
			width="100%"
			height={viewHeight + 2}
		>
			<Box flexDirection="row" justifyContent="space-between">
				<Text bold>
					Live Logs {scrollTop > 0 ? `(Scrolled: -${scrollTop})` : "(Live)"}
				</Text>
				<Text color="gray">
					{logs.length}/{maxLogs}
				</Text>
			</Box>
			{viewLogs.map((l, i) => (
				<Text key={`${l.timestamp}-${startIndex + i}`} wrap="truncate">
					<Text color="gray">
						[{l.timestamp.split("T")[1]?.split(".")[0] || "00:00:00"}]
					</Text>
					<Text
						color={
							l.level === "error"
								? "red"
								: l.level === "warn"
									? "yellow"
									: "white"
						}
					>
						{" "}
						[{l.level.toUpperCase()}]{" "}
					</Text>
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
	const [activeTickets, setActiveTickets] = useState<Ticket[]>([]);

	useEffect(() => {
		const timer = setInterval(() => {
			// This is a hacky way to get state. Ideally Conductor emits state.
			// But let's just peek at queue for now.
			const queue = getQueue();
			const rows = queue.getTicketsByStatus("processing");

			if (rows) setActiveTickets(rows);
		}, 1000);
		return () => clearInterval(timer);
	}, []);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="blue"
			width="50%"
		>
			<Text bold>Active Agents</Text>
			{activeTickets.length === 0 ? (
				<Text color="gray">No active agents</Text>
			) : null}
			{activeTickets.map((t) => (
				<Box key={t.id} flexDirection="row">
					<Text color="cyan">{t.target_role}</Text>
					<Text> -&gt; </Text>
					<Text>{t.bead_id}</Text>
					<Text color="yellow"> ({t.status})</Text>
				</Box>
			))}
		</Box>
	);
};

export const Dashboard = () => {
	const [status] = useState("Online");

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
