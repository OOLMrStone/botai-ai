"""LLM access layer.

Import surface:

    from app.llm import get_llm_client, Message

    client = get_llm_client()
    result = await client.complete_structured(
        messages=[Message.system("..."), Message.user("...")],
        schema=MyModel,
    )
    result.value      # -> MyModel
    result.meta.usage # -> token accounting
"""

from app.llm.client import LLMClient, get_llm_client, peek_llm_clients, reset_llm_client
from app.llm.types import CallMeta, LLMResult, Message, StructuredResult, Usage

__all__ = [
    "CallMeta",
    "LLMClient",
    "LLMResult",
    "Message",
    "StructuredResult",
    "Usage",
    "get_llm_client",
    "peek_llm_clients",
    "reset_llm_client",
]
