import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { type Pearl, getPearls } from "../../core/pearls";

interface TreeNode {
	pearl: Pearl;
	children: TreeNode[];
}

const buildTree = (pearls: Pearl[]): TreeNode[] => {
	const map = new Map<string, TreeNode>();
	const roots: TreeNode[] = [];

	// Initialize nodes
	for (const pearl of pearls) {
		map.set(pearl.id, { pearl, children: [] });
	}

	// Build hierarchy
	for (const pearl of pearls) {
		const node = map.get(pearl.id);
		if (!node) continue;

		if (pearl.parent && map.has(pearl.parent)) {
			const parent = map.get(pearl.parent);
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
const PearlNode = ({ node, depth }: { node: TreeNode; depth: number }) => {
	const indent = "  ".repeat(depth);
	const color =
		node.pearl.status === "done"
			? "green"
			: node.pearl.status === "verify"
				? "magenta"
				: node.pearl.status === "in_progress"
					? "yellow"
					: "white";

	const icon =
		node.pearl.status === "done"
			? "✓"
			: node.pearl.status === "verify"
				? "?"
				: node.pearl.status === "in_progress"
					? "▶"
					: "○";

	return (
		<Box flexDirection="column">
			<Text color={color}>
				{indent}
				{icon} {node.pearl.title} <Text color="gray">({node.pearl.id})</Text>
			</Text>
			{node.children.map((child) => (
				<PearlNode key={child.pearl.id} node={child} depth={depth + 1} />
			))}
		</Box>
	);
};

export const MoleculeTree = () => {
	const [tree, setTree] = useState<TreeNode[]>([]);

	useEffect(() => {
		const refresh = async () => {
			try {
				const pearls = await getPearls().getAll();
				setTree(buildTree(pearls));
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
				<PearlNode key={node.pearl.id} node={node} depth={0} />
			))}
		</Box>
	);
};
