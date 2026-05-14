"""
Gate 0 smoke test: confirm Minimax's Anthropic-compatible endpoint supports
multi-turn tool use with the model configured in rag/app/config.py.

Run:
    source .venv/bin/activate
    export MINIMAX_API_KEY=...
    python rag/scripts/smoke_minimax_agent.py

Expected output ends with:  OK -- Minimax tool-use confirmed.
"""
import os
import sys

# Make `app` importable when this script is run from the repo root.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from app import config  # noqa: F401  -- triggers MINIMAX_API_KEY -> ANTHROPIC_API_KEY mapping

from anthropic import Anthropic


TOOLS = [
    {
        "name": "add_two_numbers",
        "description": "Add two integers and return the sum.",
        "input_schema": {
            "type": "object",
            "properties": {
                "a": {"type": "integer"},
                "b": {"type": "integer"},
            },
            "required": ["a", "b"],
        },
    }
]


def main() -> int:
    if not config.MINIMAX_API_KEY:
        print("ERROR: MINIMAX_API_KEY is not set in the environment.", file=sys.stderr)
        return 2

    client = Anthropic()  # picks up ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL from env

    messages = [
        {
            "role": "user",
            "content": (
                "What is 17 + 25? You must call the add_two_numbers tool, "
                "then reply with a short sentence containing the numeric answer."
            ),
        }
    ]

    saw_tool_use = False
    saw_final_text = False

    for turn in range(4):
        resp = client.messages.create(
            model=config.AGENT_MODEL,
            max_tokens=512,
            tools=TOOLS,
            messages=messages,
        )
        print(f"turn={turn} stop_reason={resp.stop_reason}")

        # Echo each block for debugging
        for block in resp.content:
            if block.type == "text":
                print(f"  text: {block.text!r}")
            elif block.type == "tool_use":
                print(f"  tool_use: name={block.name} input={block.input}")

        messages.append({"role": "assistant", "content": resp.content})

        tool_results = []
        for block in resp.content:
            if block.type == "tool_use" and block.name == "add_two_numbers":
                saw_tool_use = True
                try:
                    total = int(block.input["a"]) + int(block.input["b"])
                except (KeyError, TypeError, ValueError) as e:
                    return _fail(f"tool input malformed: {block.input!r} ({e})")
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": str(total)}
                )
            elif block.type == "text" and "42" in block.text:
                saw_final_text = True

        if resp.stop_reason == "end_turn":
            break
        if tool_results:
            messages.append({"role": "user", "content": tool_results})

    if not saw_tool_use:
        return _fail(
            "Minimax did not emit a tool_use block. "
            "Tool use is likely unsupported on this model/base-url combination."
        )
    if not saw_final_text:
        return _fail(
            "Minimax emitted a tool_use but never produced a final answer containing 42. "
            "Multi-turn tool-use may be broken on this endpoint."
        )

    print("OK -- Minimax tool-use confirmed.")
    return 0


def _fail(msg: str) -> int:
    print(f"FAIL: {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
