#!/usr/bin/env python3
"""Transcreve o áudio de um vídeo com faster-whisper (Whisper local, sem API paga).

Uso: whisper_transcribe.py <arquivo-de-video>
Saída: uma linha JSON no stdout: {"language": "pt", "text": "..."}.
Erros vão para o stderr com código de saída != 0 (o coletor trata como "não foi possível transcrever").
"""
import json
import os
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: whisper_transcribe.py <arquivo>", file=sys.stderr)
        return 2

    path = sys.argv[1]
    from faster_whisper import WhisperModel  # import tardio: o coletor instala sob demanda

    model_name = os.environ.get("WHISPER_MODEL") or "small"  # variável vazia = padrão
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(path, vad_filter=True, beam_size=5)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(json.dumps({"language": info.language, "text": text}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
