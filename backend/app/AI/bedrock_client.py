import json
import os
from typing import List, Dict, Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from .config import AppConfig, load_config


class BedrockChat:
    """
    Minimal chat client for Amazon Bedrock using the Anthropic Claude models.

    Configuration (via environment variables):
    - AWS_REGION: e.g., "us-east-1" (required unless default chain configured)
    - BEDROCK_MODEL_ID: model id, e.g.,
        "anthropic.claude-3-haiku-20240307-v1:0"
        "anthropic.claude-3-sonnet-20240229-v1:0"
    - BEDROCK_INFERENCE_PROFILE_ARN: if set, invoke via this profile by
      providing it as the modelId (current boto3 accepts only modelId)

    AWS credentials should be provided via the standard AWS SDK methods
    (env vars, shared credentials file, instance profile, etc.).
    """

    def __init__(
        self,
        config: Optional[AppConfig] = None,
        *,
        region_name: Optional[str] = None,
        model_id: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> None:
        # Load configuration from file/env
        self.config: AppConfig = config or load_config()

        # Allow direct overrides to take precedence
        if region_name:
            self.config.aws.region = region_name
        if model_id:
            self.config.model.model_id = model_id
        if max_tokens is not None:
            self.config.model.max_tokens = max_tokens
        if temperature is not None:
            self.config.model.temperature = temperature

        # Create the Bedrock Runtime client with optional explicit creds
        client_kwargs = {
            "region_name": self.config.aws.region,
        }
        if self.config.aws.access_key_id and self.config.aws.secret_access_key:
            client_kwargs.update(
                aws_access_key_id=self.config.aws.access_key_id,
                aws_secret_access_key=self.config.aws.secret_access_key,
            )
            if self.config.aws.session_token:
                client_kwargs.update(aws_session_token=self.config.aws.session_token)

        self._client = boto3.client("bedrock-runtime", **client_kwargs)

    def _to_anthropic_messages(self, messages: List[Dict[str, str]]) -> List[Dict[str, object]]:
        """
        Convert simple [{role, content}] messages to Anthropic messages format:
        {"role": "user"|"assistant", "content": [{"type": "text", "text": "..."}]}
        """
        out: List[Dict[str, object]] = []
        for m in messages:
            role = m.get("role")
            content = m.get("content") or m.get("text") or ""
            out.append({
                "role": role,
                "content": [{"type": "text", "text": content}],
            })
        return out

    def chat(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
    ) -> str:
        """
        Send a chat conversation to Bedrock and return the assistant's reply text.

        messages: list like [{"role": "user"|"assistant", "content": "..."}, ...]
        system_prompt: optional system instruction string
        """
        payload: Dict[str, object] = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": self.config.model.max_tokens,
            "temperature": self.config.model.temperature,
            "messages": self._to_anthropic_messages(messages),
        }
        if system_prompt:
            sp = system_prompt or ""
            extras = [
                "utiliser des emojis pertinents par section",
                "séparer chaque section par une ligne horizontale '---' pour améliorer la lisibilité",
                # Ultra‑short mode: cap length and structure
                "mode synthèse stricte: 4–6 sections maximum, uniquement celles pertinentes au cas; pas besoin de toutes les sections du schéma",
                "chaque section: 2–3 puces courtes (≤ 10 mots par puce)",
                "longueur totale ≤ 200–250 mots (sauf si l'utilisateur demande explicitement des détails)",
                "ne pas inclure de sous‑sections longues, ni tableaux, ni procédures détaillées; garder seulement critères, options, et recommandation",
            ]
            low = sp.lower()
            for extra in extras:
                if extra.lower() not in low:
                    sp = f"{sp.rstrip()}\n{extra}"
                    low += "\n" + extra.lower()
            payload["system"] = sp

        try:
            response = self._client.invoke_model(
                modelId=(
                    self.config.model.inference_profile_arn
                    or self.config.model.model_id
                ),
                body=json.dumps(payload),
                contentType="application/json",
                accept="application/json",
            )
            body = response.get("body")
            data = json.loads(body.read() if hasattr(body, "read") else body)
            # Anthropic responses: {"content": [{"type": "text", "text": "..."}], ...}
            content = data.get("content") or []
            if content and isinstance(content, list):
                first = content[0]
                if isinstance(first, dict):
                    return first.get("text", "")
            # Fallbacks
            return data.get("output_text") or data.get("completion", "")
        except (BotoCoreError, ClientError) as e:
            # For production, prefer logging instead of returning error details
            return f"Error contacting Bedrock: {e}"

    def ask(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Convenience for single-turn chat."""
        msgs = [{"role": "user", "content": prompt}]
        return self.chat(msgs, system_prompt=system_prompt or self.config.model.system_prompt)
