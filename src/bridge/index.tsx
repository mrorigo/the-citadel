import { render } from "ink";
import { loadConfig } from "../config";
import { logger } from "../core/logger";
import { Conductor } from "../services/conductor";
import { Dashboard } from "./components/Dashboard";

export async function startBridge() {
	// 1. Load Config
	await loadConfig();

	// 2. Disable Console Logging (Redirect to TUI)
	logger.setConsoleEnabled(false);

	// 3. Start Conductor
	const conductor = new Conductor();
	conductor.start();

	// 4. Render TUI
	// Note: render() returns an object with unmount(), waitUntilExit(), etc.
	const { waitUntilExit } = render(<Dashboard />);

	try {
		await waitUntilExit();
	} catch (error) {
		// Force log to stderr if crash
		console.error("Bridge crashed:", error);
	} finally {
		conductor.stop();
		// creating new lines to clear the prompt
		console.log("");
	}
}
