#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { startBridge } from "./bridge/index";
import { loadConfig } from "./config";
import { getPearls } from "./core/pearls";
import { getQueue } from "./core/queue";
import { Conductor } from "./services/conductor";
import { getWorkflowEngine } from "./services/workflow-engine";

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
	readFileSync(join(__dirname, "../package.json"), "utf-8"),
);
const version = packageJson.version;

const program = new Command();

program
	.name("citadel")
	.description("The Citadel: A deterministic agent orchestration system")
	.version(version);

// --- Init Command ---

program
	.command("init")
	.description("Initialize a new Citadel project (Foundry Mode)")
	.action(async () => {
		try {
			console.log("🏗️  Initializing The Citadel...");

			const cwd = process.cwd();
			const citadelDir = join(cwd, ".citadel");
			const formulasDir = join(citadelDir, "formulas");

			// 1. Create Directory Structure
			await mkdir(formulasDir, { recursive: true });
			console.log("✅ Created .citadel/ structure");

			// 2. Scaffold Config
			const configPath = join(cwd, "citadel.config.ts");
			try {
				await access(configPath);
				console.log("ℹ️  citadel.config.ts already exists");
			} catch {
				const configTemplate = `
export default {
    env: 'development',
    providers: {
        ollama: {
            baseURL: 'http://localhost:11434/v1',
            model: 'llama3:8b', // Default local model
        },
    },
    agents: {
        worker: { 
            provider: 'ollama', 
            model: 'llama3:8b',
            mcpTools: ['filesystem:*']
        },
        gatekeeper: { 
            provider: 'ollama', 
            model: 'llama3:8b',
            mcpTools: ['filesystem:read_text_file', 'filesystem:list_directory']
        },

    },
    mcpServers: {
        filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
        },
    },
    worker: {
        timeout: 300,
        maxRetries: 3,
        costLimit: 1.00,
        min_workers: 1,
        max_workers: 5,
        load_factor: 1.0,
    },
    gatekeeper: {
        min_workers: 1,
        max_workers: 5,
        load_factor: 1.0,
    },
    pearls: {
        path: '.pearls',
        binary: 'bd',
        autoSync: true,
    },
};
`;
				await writeFile(configPath, configTemplate.trim());
				console.log("✅ Created citadel.config.ts (Ollama default)");
			}

			// 3. Scaffold AGENTS.md
			const agentsPath = join(cwd, "AGENTS.md");
			try {
				await access(agentsPath);
				console.log("ℹ️  AGENTS.md already exists");
			} catch {
				const agentsTemplate = `
# Project Rules

## Setup
- Command: \`echo "No setup defined"\`

## Test
- Command: \`echo "No tests defined"\`

## Lint
- Command: \`echo "No lint defined"\`

## Behavior
- Always write a plan before coding.
`;
				await writeFile(agentsPath, agentsTemplate.trim());
				console.log("✅ Created AGENTS.md");
			}

			// 4. Scaffold Sample Formula
			const formulaPath = join(formulasDir, "hello_world.toml");
			try {
				await access(formulaPath);
			} catch {
				const formulaTemplate = `
formula = "hello_world"
description = "A friendly greeting workflow"

[vars.name]
description = "Who to greet"
required = true
default = "World"

[[steps]]
id = "greet"
title = "Say Hello to {{name}}"
description = "Create a file named hello_{{name}}.txt with a greeting."
`;
				await writeFile(formulaPath, formulaTemplate.trim());
				console.log("✅ Created .citadel/formulas/hello_world.toml");
			}

			// 5. Initialize Pearls
			console.log("🔄 Initializing Pearls DB...");
			const pearls = getPearls(join(cwd, ".pearls"));
			await pearls.init();
			console.log("✅ Pearls initialized");

			console.log("\n🚀 Citadel initialized successfully!");
			console.log("Try running:");
			console.log(
				'  citadel create "My First Run" -f hello_world -v name=Developer',
			);
			console.log("  citadel start");
		} catch (error) {
			console.error("❌ Init failed:", error);
			process.exit(1);
		}
	});

program
	.command("start")
	.description("Start the Citadel Conductor service")
	.action(async () => {
		try {
			await loadConfig();
			const conductor = new Conductor();

			// Handle shutdown gracefully
			process.on("SIGINT", () => {
				console.log("\nReceived SIGINT. Stopping...");
				conductor.stop();
				process.exit(0);
			});

			conductor.start();

			// Keep alive
			console.log("Citadel Conductor started. Press Ctrl+C to stop.");

			// Prevent process exit
			await new Promise(() => { });
		} catch (error) {
			console.error("Failed to start Conductor:", error);
			process.exit(1);
		}
	});

program
	.command("reset-queue [pearlId]")
	.description(
		"Reset the Work Queue (Deletes persistence file or specific pearl tickets)",
	)
	.action(async (pearlId) => {
		try {
			if (pearlId) {
				await loadConfig();
				const queue = getQueue();
				console.log(`Resetting tickets for pearl: ${pearlId}...`);
				queue.resetPearl(pearlId);
				console.log(`Tickets for ${pearlId} have been cleared.`);
			} else {
				const dbPath = resolve(process.cwd(), ".citadel", "queue.sqlite");
				console.log(`Resetting entire queue at ${dbPath}...`);
				await unlink(dbPath);
				console.log("Queue reset successfully.");
			}
		} catch (error) {
			if (!pearlId && (error as { code?: string }).code === "ENOENT") {
				console.log("Queue file not found. Nothing to reset.");
			} else {
				console.error("Failed to reset queue:", error);
			}
		}
	});

program
	.command("inspect <pearlId>")
	.description("Inspect the active ticket for a pearl")
	.action(async (pearlId) => {
		await loadConfig();
		const ticket = getQueue().getActiveTicket(pearlId);
		if (ticket) {
			console.log(JSON.stringify(ticket, null, 2));
		} else {
			console.log(`No active ticket found for ${pearlId}`);
		}
	});

program
	.command("queue")
	.description("List all tickets in the work queue")
	.option("-s, --status <status>", "Filter by status (queued, processing, completed, failed)")
	.option("-j, --json", "Output in JSON format")
	.action(async (options) => {
		await loadConfig();
		const queue = getQueue();
		const tickets = queue.getAllTickets(options.status);

		if (options.json) {
			console.log(JSON.stringify(tickets, null, 2));
			return;
		}

		if (tickets.length === 0) {
			console.log("No tickets found in the queue.");
			return;
		}

		console.log("Work Queue:");
		console.log("=".repeat(80));
		console.log(
			`${"ID".padEnd(38)} | ${"Pearl ID".padEnd(20)} | ${"Status".padEnd(12)} | ${"Created At"}`,
		);
		console.log("-".repeat(80));
		for (const t of tickets) {
			const createdAt = new Date(t.created_at).toLocaleString();
			console.log(
				`${t.id.padEnd(38)} | ${t.pearl_id.padEnd(20)} | ${t.status.padEnd(12)} | ${createdAt}`,
			);
		}
		console.log("=".repeat(80));
	});

program
	.command("bridge")
	.description("Start The Bridge (TUI Dashboard)")
	.action(async () => {
		await startBridge();
	});

program
	.command("create <title>")
	.description("Create a new molecule from a formula")
	.option("-f, --formula <name>", "Formula name to use")
	.option("-v, --vars <items...>", "Variables key=value", [])
	.action(async (_title, options) => {
		if (!options.formula) {
			console.error("Error: --formula is required for citadel create");
			process.exit(1);
		}

		await loadConfig();
		const engine = getWorkflowEngine();
		await engine.init();

		// Parse variables
		const variables: Record<string, string> = {};
		if (options.vars) {
			for (const item of options.vars) {
				const [k, v] = item.split("=");
				if (k && v) variables[k] = v;
			}
		}

		try {
			const moleculeId = await engine.instantiateFormula(
				options.formula,
				variables,
			);
			console.log(`Successfully created molecule: ${moleculeId}`);
		} catch (error: unknown) {
			const err = error as Error;
			console.error("Failed to instantiate formula:", err.message);
			process.exit(1);
		}
	});

program.parse(process.argv);
