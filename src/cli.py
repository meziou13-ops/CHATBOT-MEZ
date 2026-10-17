"""Chatbot en ligne de commande : python -m src.cli"""
import sys

from groq import Groq

from .config import DEFAULT_LEVEL, DEFAULT_MODEL, api_key
from .persona import build_system_prompt


def build_client() -> Groq:
    key = api_key()
    if not key:
        sys.exit("GROQ_API_KEY manquant : vérifie ton fichier .env")
    return Groq(api_key=key)


def chat_loop(client: Groq) -> None:
    history = [{"role": "system", "content": build_system_prompt(DEFAULT_LEVEL)}]
    print("Chatbot prêt. Tape 'exit' pour quitter.\n")
    while True:
        user_input = input("Toi : ").strip()
        if user_input.lower() in {"exit", "quit"}:
            break
        if not user_input:
            continue
        history.append({"role": "user", "content": user_input})
        response = client.chat.completions.create(model=DEFAULT_MODEL, messages=history)
        reply = response.choices[0].message.content
        history.append({"role": "assistant", "content": reply})
        print(f"Bot : {reply}\n")


def main() -> None:
    chat_loop(build_client())


if __name__ == "__main__":
    main()
