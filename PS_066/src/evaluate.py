"""Evaluation routines for OceanEmbed held-out test inference and metric calculation.

Computes RMSE, bias, climatological baseline RMSE, and anomaly correlation
across the 15 standard depths on held-out test data (May-June 2021).
"""

from typing import Dict, List, Optional
import numpy as np
import torch
from .model import OceanEmbedNet

DEPTHS = [0.5, 5.1, 9.6, 18.5, 29.4, 47.4, 77.9, 92.3, 130.7, 155.9, 186.1, 318.1, 541.1, 643.6, 902.3]

class PersistenceBaseline:
    """Computes error metrics by assuming today's subsurface temperature is identical to yesterday's."""
    def __init__(self, history_y: np.ndarray):
        self.history_y = history_y

    def predict(self, start_idx: int, end_idx: int) -> np.ndarray:
        return self.history_y[start_idx - 1 : end_idx - 1]


def evaluate_model(
    prepared_data_path: str = "data/prepared.npz",
    model_path: str = "models/model.pt",
    device: Optional[str] = None,
) -> List[Dict[str, float]]:
    """Evaluate trained model on held-out test days and compute verification metrics.

    Args:
        prepared_data_path: Path to prepared.npz.
        model_path: Path to saved model weights.
        device: 'cuda' or 'cpu'. Defaults to CUDA if available.

    Returns:
        List of dictionaries with depth, RMSE, bias, baseline_RMSE, and anomaly_corr.
    """
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    d = np.load(prepared_data_path)
    Xn, Yn, M = d["Xn"], d["Yn"], d["M"]
    ntrain = int(d["ntrain"])
    mu_y, sd_y = d["mu_y"], d["sd_y"]

    model = OceanEmbedNet().to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    Xte = torch.tensor(Xn[ntrain:], dtype=torch.float32).to(device)
    with torch.no_grad():
        P = model(Xte).cpu().numpy()

    den = lambda a: a * sd_y + mu_y
    Yall = den(Yn)
    Pt = den(P)
    Tt = Yall[ntrain:]
    Mt = M[ntrain:]

    Ytr_d = Yall[:ntrain]
    Mall = M[:ntrain]
    clim = (Ytr_d * Mall).sum(0, keepdims=True) / np.maximum(Mall.sum(0, keepdims=True), 1)

    persis_baseline = PersistenceBaseline(Yall)
    Y_persis = persis_baseline.predict(ntrain, len(Yall))

    results = []
    print("\ndepth(m)  RMSE   bias   baseline_RMSE  persis_RMSE  anomaly_corr")
    for k in range(len(DEPTHS)):
        m = Mt[:, k] > 0
        p, t = Pt[:, k][m], Tt[:, k][m]
        c = np.broadcast_to(clim[:, k], Pt[:, k].shape)[m]
        persis = Y_persis[:, k][m]
        rmse = float(np.sqrt(np.mean((p - t) ** 2)))
        bias = float(np.mean(p - t))
        rb = float(np.sqrt(np.mean((c - t) ** 2)))
        rp = float(np.sqrt(np.mean((persis - t) ** 2)))
        r = float(np.corrcoef(p - c, t - c)[0, 1])
        print(f"{DEPTHS[k]:7.1f}  {rmse:5.2f}  {bias:6.2f}  {rb:13.2f}  {rp:11.2f}  {r:12.2f}")
        results.append(
            {
                "depth_m": DEPTHS[k],
                "rmse_c": rmse,
                "bias_c": bias,
                "baseline_rmse_c": rb,
                "persis_rmse_c": rp,
                "anomaly_corr": r,
            }
        )

    return results
