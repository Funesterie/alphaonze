import json
from collections import defaultdict

# Axes and their prime identifiers
AXES = {
    "subject": 2,
    "attribute": 3,
    "environment": 5,
    "style": 7,
    "composition": 11,
    "action": 13,
    "constraint": 17,
    "mood": 19
}

class Node:
    def __init__(self, value, axis):
        self.value = value
        self.axis = axis
        self.id = None

class Relation:
    def __init__(self, from_node, to_node, weight, rel_type):
        self.from_node = from_node
        self.to_node = to_node
        self.weight = weight
        self.rel_type = rel_type

class CasqueEtoile:
    def __init__(self):
        self.nodes = []
        self.relations = []
        self.node_map = {}

    def add_node(self, value, axis):
        node = Node(value, axis)
        node.id = f"n{len(self.nodes)+1}"
        self.nodes.append(node)
        self.node_map[value] = node
        return node

    def add_relation(self, from_value, to_value, weight):
        from_node = self.node_map[from_value]
        to_node = self.node_map[to_value]
        rel_type = AXES[from_node.axis] * AXES[to_node.axis]
        self.relations.append(Relation(from_node, to_node, weight, rel_type))

    def to_mask(self, raw):
        # Example: group attributes/environments by subject
        subjects = [n for n in self.nodes if n.axis == "subject"]
        mask_subjects = []
        for subj in subjects:
            attributes = [r.to_node.value for r in self.relations if r.from_node == subj and r.to_node.axis == "attribute" and r.weight > 0.7]
            environments = [r.to_node.value for r in self.relations if r.from_node == subj and r.to_node.axis == "environment" and r.weight > 0.5]
            mask_subjects.append({
                "value": subj.value,
                "attributes": attributes,
                "environment": environments,
                "importance": "high"
            })
        mask = {
            "version": "mask-1",
            "intent": "image.generate",
            "slots": {
                "subject": mask_subjects
            },
            "relations": [
                {
                    "from": r.from_node.value,
                    "to": r.to_node.value,
                    "type": self.axis_pair_name(r.from_node.axis, r.to_node.axis),
                    "weight": r.weight
                } for r in self.relations
            ],
            "confidence": self.estimate_confidence(),
            "ambiguities": [],
            "raw": raw
        }
        return mask

    def axis_pair_name(self, a1, a2):
        return f"{a1}-{a2}"

    def estimate_confidence(self):
        # Simple heuristic: more strong relations = higher confidence
        strong = sum(1 for r in self.relations if r.weight > 0.7)
        total = len(self.relations) or 1
        return round(0.5 + 0.5 * (strong / total), 2)

# Example usage
if __name__ == "__main__":
    casque = CasqueEtoile()
    casque.add_node("lapin", "subject")
    casque.add_node("violet", "attribute")
    casque.add_node("forêt", "environment")
    casque.add_relation("lapin", "violet", 0.95)
    casque.add_relation("lapin", "forêt", 0.7)
    mask = casque.to_mask("un lapin violet dans une forêt")
    print(json.dumps(mask, ensure_ascii=False, indent=2))
