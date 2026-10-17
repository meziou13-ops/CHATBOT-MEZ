"""Lancement local : python -m src.main"""
import os

import uvicorn

from .config import BASE_DIR


def main() -> None:
    uvicorn.run(
        "src.app:app",
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "8000")),
        reload=True,
        reload_dirs=[str(BASE_DIR / "src")],
    )


if __name__ == "__main__":
    main()
