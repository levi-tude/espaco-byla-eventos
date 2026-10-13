"""Desliga a cobrança do projeto quando o gasto do mês passa do orçamento.

Recebe as mensagens do orçamento (Pub/Sub). Sem cobrança ligada, o Google
para todos os serviços do projeto, então o site sai do ar até alguém religar
a conta de cobrança no console.
"""

import base64
import json
import os

import functions_framework
from google.cloud import billing_v1

PROJECT_ID = os.environ.get("TARGET_PROJECT_ID", "")


@functions_framework.cloud_event
def stop_billing(cloud_event) -> None:
    try:
        raw = base64.b64decode(cloud_event.data["message"]["data"]).decode("utf-8")
        payload = json.loads(raw)
        cost = float(payload.get("costAmount", 0))
        budget = float(payload.get("budgetAmount", 0))
    except (KeyError, TypeError, ValueError) as error:
        print(f"Mensagem ignorada (formato inesperado): {error}")
        return
    print(f"Gasto: {cost} Orçamento: {budget}")

    if not PROJECT_ID or budget <= 0 or cost <= budget:
        return

    client = billing_v1.CloudBillingClient()
    name = f"projects/{PROJECT_ID}"
    if not client.get_project_billing_info(name=name).billing_enabled:
        print("Cobrança já estava desligada.")
        return

    client.update_project_billing_info(
        name=name,
        project_billing_info=billing_v1.ProjectBillingInfo(billing_account_name=""),
    )
    print("Cobrança desligada: gasto passou do orçamento.")
