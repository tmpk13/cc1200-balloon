"""Minimal position-aware s-expression reader for KiCad files.

Parses a file into nested lists while recording the byte span of every list
node, so a caller can splice edits into the original text without
re-serializing (which would churn formatting and uuids).
"""

import re

_TOKEN = re.compile(r'\s*(?:(\()|(\))|"((?:[^"\\]|\\.)*)"|([^\s()"]+))', re.S)


class Node(list):
    """A list node that also knows where it came from in the source text."""

    __slots__ = ("start", "end")

    def __init__(self):
        super().__init__()
        self.start = 0
        self.end = 0


def parse(text):
    """Return the list of top-level nodes; strings are unescaped."""
    stack = [Node()]
    pos = 0
    n = len(text)
    while pos < n:
        m = _TOKEN.match(text, pos)
        if not m or m.end() == pos:
            break
        pos = m.end()
        if m.group(1):
            node = Node()
            node.start = m.start(1)
            stack.append(node)
        elif m.group(2):
            node = stack.pop()
            node.end = m.end(2)
            stack[-1].append(node)
        elif m.group(3) is not None:
            stack[-1].append(m.group(3).replace('\\"', '"'))
        else:
            stack[-1].append(m.group(4))
    return stack[0]


def children(node, name):
    return [k for k in node if isinstance(k, list) and k and k[0] == name]


def child(node, name):
    for k in node:
        if isinstance(k, list) and k and k[0] == name:
            return k
    return None


def prop(node, name):
    for k in children(node, "property"):
        if len(k) > 2 and k[1] == name:
            return k
    return None


def quote(s):
    return '"' + s.replace('"', '\\"') + '"'


def apply_edits(text, edits):
    """Apply (start, end, replacement) splices, last-first so offsets hold."""
    for start, end, repl in sorted(edits, key=lambda e: e[0], reverse=True):
        text = text[:start] + repl + text[end:]
    return text
