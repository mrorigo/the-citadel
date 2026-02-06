import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { type Bead, getBeads } from "../../core/beads";

interface TreeNode {
	bead: Bead;
	children: TreeNode[];
}

const buildTree = (beads: Bead[]): TreeNode[] => {
	const map = new Map<string, TreeNode>();
	const roots: TreeNode[] = [];

	// Initialize nodes
	for (const bead of beads) {
		map.set(bead.id, { bead, children: [] });
	}

	// Build hierarchy
	for (const bead of beads) {
		const node = map.get(bead.id);
		if (!node) continue;

		if (bead.parent && map.has(bead.parent)) {
			const parent = map.get(bead.parent);
			if (parent) {
				parent.children.push(node);
			}
		} else {
			roots.push(node);
		}
	}

	return roots;
};

// Recursive Node Component
const BeadNode = ({ node, depth }: { node: TreeNode; depth: number }) => {
	const indent = "  ".repeat(depth);
	const color =
		node.bead.status === "done"
			? "green"
			: node.bead.status === "verify"
				? "magenta"
				: node.bead.status === "in_progress"
					? "yellow"
					: "white";

	const icon =
		node.bead.status === "done"
			? "✓"
			: node.bead.status === "verify"
				? "?"
				: node.bead.status === "in_progress"
					? "▶"
					: "○";

	return (
		<Box flexDirection="column">
			<Text color={color}>
				{indent}
				{icon} {node.bead.title} <Text color="gray">({node.bead.id})</Text>
			</Text>
			{node.children.map((child) => (
				<BeadNode key={child.bead.id} node={child} depth={depth + 1} />
			))}
		</Box>
	);
};

export const MoleculeTree = () => {
	const [tree, setTree] = useState<TreeNode[]>([]);

	useEffect(() => {
		const refresh = async () => {
			try {
				const beads = await getBeads().getAll();
				setTree(buildTree(beads));
			} catch (_e) {
				// Ignore errors during refresh (might be due to concurrent writes)
			}
		};

		refresh();
		const timer = setInterval(refresh, 2000);
		return () => clearInterval(timer);
	}, []);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="magenta"
			width="50%"
			height={15}
			overflowY="hidden"
		>
			<Text bold>Molecules</Text>
			{tree.length === 0 ? <Text color="gray">No molecules found</Text> : null}
			{tree.map((node) => (
				<BeadNode key={node.bead.id} node={node} depth={0} />
			))}
		</Box>
	);
};
