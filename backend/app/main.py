from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import os
import asyncio
import logging

# Amazon Transcribe Streaming SDK
from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.model import TranscriptEvent

from app.AI.bedrock_client import BedrockChat
from app.AI.config import load_config


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    # Backward compatibility: allow either a single message or full history
    message: Optional[str] = Field(default=None, description="Single user message")
    messages: Optional[List[Message]] = Field(
        default=None,
        description="Full chat history as list of {role, content}",
    )


class ChatResponse(BaseModel):
    reply: str


app = FastAPI(title="MedAI Backend", version="0.1.0")


def _parse_cors_origins() -> List[str]:
    raw = os.getenv("MEDAI_CORS_ORIGINS", "").strip()
    if raw == "*":
        return ["*"]
    if raw:
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        if parts:
            return parts
    return [
        "http://localhost:443",
        "http://127.0.0.1:443",
    ]


_CORS_ORIGINS = _parse_cors_origins()
_ALLOW_CREDENTIALS_ENV = os.getenv("MEDAI_CORS_ALLOW_CREDENTIALS", "true").lower() == "true"
# Browsers disallow credentials with wildcard origin. Avoid sending creds with "*".
_ALLOW_CREDENTIALS = _ALLOW_CREDENTIALS_ENV and _CORS_ORIGINS != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


"""
Avoid creating the Bedrock client at import time so the app can start
even if AWS credentials/region aren't configured yet. We lazily
initialize on first use.
"""
_CONFIG = load_config()
_bedrock_client: Optional[BedrockChat] = None


def _get_bedrock() -> BedrockChat:
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = BedrockChat(config=_CONFIG)
    return _bedrock_client


# Removed server-side shortening: keep model output intact


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    # Prefer multi-turn history if provided; otherwise fall back to single-turn
    try:
        br = _get_bedrock()
        if req.messages:
            # Convert Pydantic models to plain dicts
            history = [{"role": m.role, "content": m.content} for m in req.messages]
            reply = br.chat(history, system_prompt=_CONFIG.model.system_prompt)
        else:
            msg = req.message or ""
            reply = br.ask(msg, system_prompt=_CONFIG.model.system_prompt)
    except Exception as e:
        reply = f"Server configuration error: {e}"
    # Return model reply without post-processing
    return {"reply": reply}


@app.get("/debug/system_prompt")
def debug_system_prompt():
    """Expose effective system prompt (for debugging only)."""
    return {
        "model_id": _CONFIG.model.model_id,
        "temperature": _CONFIG.model.temperature,
        "max_tokens": _CONFIG.model.max_tokens,
        "system_prompt": _CONFIG.model.system_prompt,
        "note": "Do not expose in production.",
    }


# --------------------------
# Amazon Transcribe Streaming
# --------------------------

def _normalize_lang(lang: Optional[str]) -> str:
    # Allow simple values like 'fr'/'en' and expand to supported codes
    if not lang:
        return "fr-FR"
    l = lang.strip()
    if l.lower() in ("fr", "fr-fr", "fr_fr"):  # French
        return "fr-FR"
    if l.lower() in ("en", "en-us", "en_us"):  # English (US)
        return "en-US"
    # Fallback to fr-FR if unsupported
    return "fr-FR"


@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket):

    logger = logging.getLogger("medai.transcribe")
    logger.setLevel(logging.DEBUG)
    logger.info("Websocket started running.")
    """WebSocket proxy to Amazon Transcribe Streaming.

    Client responsibilities:
    - Connect with optional query params: ?lang=fr-FR&sample_rate=16000&encoding=pcm
    - Send binary frames containing raw PCM 16-bit LE audio at the agreed sample rate (default 16kHz).
    - When done, send a text frame with content 'END' or simply close.

    Server behavior:
    - Forwards binary audio to Transcribe input stream.
    - Streams back partial and final transcripts as JSON text frames:
        {"type":"partial","text":"..."}
        {"type":"final","text":"..."}
    """
    
    # Allow toggling verbosity via env var
   
    


    await websocket.accept()
    try:
        params = websocket.query_params
        lang = _normalize_lang(params.get("lang"))
        try:
            sample_rate = int(params.get("sample_rate") or 16000)
        except Exception:
            sample_rate = 16000
        encoding = (params.get("encoding") or "pcm").lower()
        if encoding not in ("pcm", "ogg-opus"):
            encoding = "pcm"

        # Initialize Transcribe Streaming client lazily
        region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"
        client = TranscribeStreamingClient(region=region)

        client_host = getattr(getattr(websocket, "client", None), "host", "?")
        client_port = getattr(getattr(websocket, "client", None), "port", "?")
        logger.info("WS connect from %s:%s | lang=%s sr=%s enc=%s region=%s", client_host, client_port, lang, sample_rate, encoding, region)

        # Start a stream with selected params
        logger.debug("Starting Transcribe stream...")
        stream = await client.start_stream_transcription(
            language_code=lang,
            media_sample_rate_hz=sample_rate,
            media_encoding=encoding,
        )
        logger.info("Transcribe stream started")

        stats = {
            "bytes_in": 0,
            "frames_in": 0,
            "partials_out": 0,
            "finals_out": 0,
        }

        async def forward_audio():
            try:
                while True:
                    msg = await websocket.receive()
                    if msg.get("type") == "websocket.disconnect":
                        logger.info("WebSocket disconnect signal received during audio forward")
                        break
                    if "bytes" in msg and msg["bytes"] is not None:
                        chunk = msg["bytes"]
                        size = len(chunk)
                        stats["bytes_in"] += size
                        stats["frames_in"] += 1
                        if stats["frames_in"] % 50 == 0:
                            logger.debug(
                                "Forwarded %s frames (%s bytes) to Transcribe",
                                stats["frames_in"],
                                stats["bytes_in"],
                            )
                        await stream.input_stream.send_audio_event(audio_chunk=chunk)
                    elif "text" in msg and msg["text"] is not None:
                        # If client signals end, stop upstream
                        signal = msg["text"].strip()
                        logger.debug("Received text control frame: %r", signal)
                        if signal.upper() == "END":
                            logger.info("END signal received from client; closing input stream")
                            break
            finally:
                # End the input audio stream to flush any buffered results
                try:
                    await stream.input_stream.end_stream()
                except Exception:
                    pass
                logger.info(
                    "Audio input stream closed | frames=%s bytes=%s",
                    stats["frames_in"],
                    stats["bytes_in"],
                )

        async def relay_transcripts():
            async for event in stream.output_stream:
                if isinstance(event, TranscriptEvent):
                    results = event.transcript.results or []
                    for res in results:
                        # res.is_partial indicates interim hypothesis
                        is_final = not getattr(res, "is_partial", False)
                        for alt in (res.alternatives or []):
                            text = (alt.transcript or "").strip()
                            if not text:
                                continue
                            snippet = (text[:120] + "…") if len(text) > 120 else text
                            if is_final:
                                stats["finals_out"] += 1
                                logger.debug("Final #%s: %s", stats["finals_out"], snippet)
                            else:
                                stats["partials_out"] += 1
                                # Throttle partial logs
                                if stats["partials_out"] % 10 == 0:
                                    logger.debug("Partial #%s: %s", stats["partials_out"], snippet)

                            payload = {
                                "type": "final" if is_final else "partial",
                                "text": text,
                                "language": lang,
                            }
                            await websocket.send_json(payload)

        # Run both tasks concurrently
        await asyncio.gather(forward_audio(), relay_transcripts())

    except WebSocketDisconnect:
        # Client disconnected; nothing else to do
        logging.getLogger("medai.transcribe").info("WebSocket disconnected")
        return
    except Exception as e:
        logging.getLogger("medai.transcribe").exception("Transcribe WS error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
        finally:
            try:
                await websocket.close()
            except Exception:
                pass
