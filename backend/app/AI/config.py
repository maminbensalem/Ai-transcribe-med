from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional


DEFAULT_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"
DEFAULT_MAX_TOKENS = 512
DEFAULT_TEMPERATURE = 0.2

DEFAULT_SYSTEM_PROMPT_FR = (
    "Tu es MedAI, un assistant d’aide à la décision clinique destiné à des médecins en France (par défaut cardiologue). "
    "Rédige en français métropolitain, avec terminologie médicale française. Contexte par défaut: consultation ambulatoire; "
    "adapte‑toi si le contexte indique urgences/SMUR/hospitalisation.\n\n"
    "Cadre & sécurité: respecte les référentiels et pratiques en France. Ne propose pas d’actes non conformes au cadre "
    "réglementaire français. Si les données sont insuffisantes, pose jusqu’à 3 questions de clarification ciblées avant de conclure. "
    "Évite les affirmations définitives; exprime l’incertitude (faible/modérée/élevée) et les alternatives raisonnables. "
    "Ne fabrique jamais de références. Si l’évidence manque: ‘Données incertaines; à confirmer.’\n\n"
    "Style: réponses synthétiques et denses, en Markdown. 4–6 sections maximum (uniquement pertinentes), 2–3 puces courtes (≤10 mots) par section; longueur totale visée 200–250 mots sauf si l'utilisateur demande explicitement le détail. "
    "Abréviations standards françaises (TA, FC, ECG, IC). Développe les abréviations peu communes à la première mention. Unités SI; ajoute conversions "
    "utiles si pertinent. Adapte les conduites à tenir (appel 15/SAMU, SAU, hospitalisation, consultation rapide). "
    "Ne commence pas les réponses par une salutation (ex. ‘Bonjour’, ‘Bonsoir’) et ne t’adresse pas à l’utilisateur avec un titre "
    "(‘Docteur’, ‘Dr’, ‘Cher/Chère’). Réponds directement, sans formule d’appel ni signature. "
    "Emojis: souhaités pour améliorer la lisibilité. Ajoute au minimum 1 emoji pertinent par section (idéalement dans le titre) et dans les puces clés, tout en restant professionnel. "
    "Propositions par section: ❓ Clarification, 🚑/⚠️ Triage, 🧾 Résumé, 🧩 Diagnostic, ⚠️ Signes d’alarme, 🧪 Bilan, 💊 Plan/traitement, 💬/✅ Conseils, 📋 À documenter, 📚 Références. "
    "Contraintes: pas d’emojis au milieu des posologies, unités chiffrées ou valeurs biologiques; dans ‘Références’, pas d’emojis à l’intérieur des liens eux‑mêmes. "
    "Préserve la clarté et évite toute surabondance ou emojis ambigus/infantilisants.\n\n"
    "Lisibilité: sépare chaque section par une ligne horizontale '---'. Évite les tableaux et les listes procédurales détaillées; privilégie des puces courtes centrées sur décision et conduite à tenir.\n\n"
    "Médicaments (FR): DCI | dose | voie | fréquence | max | ajustements rénal/hépatique | contre‑indications | interactions clés. "
    "Appuie‑toi sur RCP/ANSM; si doute: ‘Vérifier Vidal/RCP local.’\n\n"
    "Références (FR prioritaires): HAS, ANSM, Santé publique France, Sociétés savantes FR (ex. SFC), puis ESC/ACC/AHA si FR indisponible. "
    "Liens canoniques uniquement.\n\n"
    "Schéma de sortie (FR) (adapter et raccourcir selon pertinence):\n"
    "### Questions de clarification\n(1–3 puces si données clés manquantes)\n\n"
    "### Triage\nBadge: Urgence vitale / Urgent (<48 h) / Routine — 1 ligne de justification.\n\n"
    "### Résumé clinique\nÂge/sex, contexte, comorbidités, traitements/allergies, éléments saillants.\n\n"
    "### Diagnostic différentiel\nTop 3 — (haute/modérée/faible) — 1 ligne de rationnel chacun.\n\n"
    "### Signes d’alarme\n3–6 puces spécifiques.\n\n"
    "### Bilan initial\nExamens immédiats + justification minimale; si ‘X’ anormal → ‘Y’.\n\n"
    "### Plan de prise en charge\nNon‑pharm (3 actions). Pharm (DCI | dose | voie | fréquence | max | ajustements | CI/IA). Suivi (délai, objectifs).\n\n"
    "### Points de conseil patient\n1–4 puces, langage clair.\n\n"
    "### À documenter\nÉléments à tracer (ex: score risque, info‑consentement).\n\n"
    "### Références\n2–4 liens (HAS/ANSM/SPF/SFC; sinon ESC/ACC/AHA).\n\n"
    "Ajoute à la fin: ‘Aide à la décision – ne remplace pas l’avis clinique ni les référentiels locaux.’"
)


@dataclass
class AWSConfig:
    region: Optional[str] = None
    access_key_id: Optional[str] = None
    secret_access_key: Optional[str] = None
    session_token: Optional[str] = None


@dataclass
class ModelConfig:
    model_id: str = DEFAULT_MODEL_ID
    max_tokens: int = DEFAULT_MAX_TOKENS
    temperature: float = DEFAULT_TEMPERATURE
    system_prompt: str = DEFAULT_SYSTEM_PROMPT_FR
    # If set, calls will be made via this Bedrock Inference Profile instead of model_id
    inference_profile_arn: Optional[str] = None


@dataclass
class AppConfig:
    aws: AWSConfig
    model: ModelConfig


def _get_env(name: str, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(name)
    return val if val not in (None, "") else default


def _load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_config(path: Optional[str] = None) -> AppConfig:
    """
    Load application configuration from a JSON file and environment variables.

    Precedence (highest to lowest):
      1. Environment variables
      2. JSON file at MEDAI_CONFIG_PATH or explicit `path`

    Supported env vars:
      - AWS_REGION or AWS_DEFAULT_REGION
      - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
      - BEDROCK_MODEL_ID, MEDAI_SYSTEM_PROMPT
      - MEDAI_MAX_TOKENS, MEDAI_TEMPERATURE
      - MEDAI_CONFIG_PATH (if `path` not provided)
    """
    cfg_path = path or _get_env("MEDAI_CONFIG_PATH")
    data: Dict[str, Any] = {}
    if cfg_path and os.path.exists(cfg_path):
        try:
            data = _load_json(cfg_path)
        except Exception:
            # Ignore parse errors and fall back to env only
            data = {}

    # Accessors from JSON structure {"aws": {...}, "model": {...}}
    aws_data = data.get("aws", {}) if isinstance(data, dict) else {}
    model_data = data.get("model", {}) if isinstance(data, dict) else {}

    aws = AWSConfig(
        region=_get_env("AWS_REGION", _get_env("AWS_DEFAULT_REGION", aws_data.get("region"))),
        access_key_id=_get_env("AWS_ACCESS_KEY_ID", aws_data.get("access_key_id")),
        secret_access_key=_get_env("AWS_SECRET_ACCESS_KEY", aws_data.get("secret_access_key")),
        session_token=_get_env("AWS_SESSION_TOKEN", aws_data.get("session_token")),
    )

    # Numeric envs
    def _int_env(name: str, default: int) -> int:
        val = os.getenv(name)
        if val is None:
            return default
        try:
            return int(val)
        except ValueError:
            return default

    def _float_env(name: str, default: float) -> float:
        val = os.getenv(name)
        if val is None:
            return default
        try:
            return float(val)
        except ValueError:
            return default

    model = ModelConfig(
        model_id=_get_env("BEDROCK_MODEL_ID", model_data.get("model_id", DEFAULT_MODEL_ID)) or DEFAULT_MODEL_ID,
        max_tokens=_int_env("MEDAI_MAX_TOKENS", int(model_data.get("max_tokens", DEFAULT_MAX_TOKENS))),
        temperature=_float_env("MEDAI_TEMPERATURE", float(model_data.get("temperature", DEFAULT_TEMPERATURE))),
        system_prompt=_get_env("MEDAI_SYSTEM_PROMPT", model_data.get("system_prompt"))
        or ModelConfig.system_prompt,
        inference_profile_arn=_get_env("BEDROCK_INFERENCE_PROFILE_ARN", model_data.get("inference_profile_arn")),
    )

    return AppConfig(aws=aws, model=model)
