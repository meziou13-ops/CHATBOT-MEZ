# Gunners IA

Chatbot web connecté à l'API Groq : un oracle hautain, fan d'Arsenal, qui te toise
avec le mépris qui va avec. Projet de fan, non officiel.

## Stack

- Backend : Python, Starlette + Uvicorn, streaming SSE
- LLM : API Groq (`openai/gpt-oss-20b` par défaut, `openai/gpt-oss-120b` en option)
- Interface : HTML, CSS et JavaScript sans framework (historique stocké dans le navigateur)

## Installation

~~~bash
python -m venv venv
source venv/Scripts/activate        # Git Bash sous Windows
pip install -r requirements.txt
cp .env.example .env                # puis renseigne GROQ_API_KEY
~~~

## Lancer en local

~~~bash
python -m src.main                  # http://127.0.0.1:8000
~~~

Version terminal : `python -m src.cli`

## Tests

~~~bash
pip install -r requirements-dev.txt
python -m unittest
~~~

## Structure

~~~
src/
  app.py        routes, streaming SSE
  llm.py        appel Groq, gestion des erreurs
  persona.py    prompt système et niveaux de mépris
  schemas.py    validation des requêtes
  security.py   limitation de débit, en-têtes HTTP
  config.py     modèles, niveaux, limites
  main.py       lancement local
  cli.py        chatbot en ligne de commande
static/         interface (index.html, css, js, logo)
tests/          tests unitaires de l'API
~~~

## Statut

Interface validée, tests en local, déploiement Render à venir.
