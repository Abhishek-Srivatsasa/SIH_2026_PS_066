"""Training pipeline for OceanEmbedNet.

Implements model optimisation using AdamW, validation tracking on a held-out temporal slice,
and checkpoint saving matching the proof-of-concept configuration.
"""

import os
from typing import Dict, Optional, Tuple
import numpy as np
import torch
from .model import OceanEmbedNet, loss_fn


class SatelliteDropoutAugmentation:
    """Randomly applies spatial masking and Gaussian noise to surface input channels (SST, SSS, SSH)."""
    def __init__(self, p_mask: float = 0.2, noise_std: float = 0.05):
        self.p_mask = p_mask
        self.noise_std = noise_std

    def __call__(self, x: torch.Tensor) -> torch.Tensor:
        x_aug = x.clone()
        B, C, H, W = x_aug.shape
        
        # Spatial masking (simulating cloud cover)
        mask = torch.rand((B, 1, H, W), device=x.device) > self.p_mask
        
        # Gaussian noise
        noise = torch.randn((B, 3, H, W), device=x.device) * self.noise_std
        
        x_aug[:, :3] = (x_aug[:, :3] + noise) * mask
        return x_aug


def train_model(
    prepared_data_path: str = "data/prepared.npz",
    model_save_path: str = "models/model.pt",
    epochs: int = 80,
    batch_size: int = 8,
    lr: float = 1e-3,
    weight_decay: float = 1e-4,
    val_days: int = 15,
    device: Optional[str] = None,
) -> Tuple[OceanEmbedNet, Dict[str, torch.Tensor], float]:
    """Train OceanEmbedNet on prepared arrays and save best checkpoint.

    Args:
        prepared_data_path: Path to prepared.npz containing Xn, Yn, M, ntrain.
        model_save_path: Destination path for saving best model state dict.
        epochs: Number of training epochs (default: 80).
        batch_size: Batch size for mini-batch optimisation (default: 8).
        lr: AdamW learning rate (default: 1e-3).
        weight_decay: AdamW weight decay (default: 1e-4).
        val_days: Days reserved from end of training set for validation (default: 15).
        device: 'cuda' or 'cpu'. Defaults to CUDA if available.

    Returns:
        Tuple of (trained_model, best_state_dict, best_val_loss).
    """
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    d = np.load(prepared_data_path)
    Xn, Yn, M = d["Xn"], d["Yn"], d["M"]
    ntrain = int(d["ntrain"])

    ntr = ntrain - val_days
    tt = lambda a: torch.tensor(a, dtype=torch.float32).to(device)

    Xtr, Ytr, Mtr = tt(Xn[:ntr]), tt(Yn[:ntr]), tt(M[:ntr])
    Xva, Yva, Mva = tt(Xn[ntr:ntrain]), tt(Yn[ntr:ntrain]), tt(M[ntr:ntrain])

    model = OceanEmbedNet().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)

    best_state = None
    best_val = 1e9

    aug = SatelliteDropoutAugmentation()

    for ep in range(epochs):
        model.train()
        perm = torch.randperm(ntr, device=device)
        for i in range(0, ntr, batch_size):
            idx = perm[i : i + batch_size]
            opt.zero_grad()
            x_batch = aug(Xtr[idx])
            loss = loss_fn(model(x_batch), Ytr[idx], Mtr[idx])
            loss.backward()
            opt.step()

        model.eval()
        with torch.no_grad():
            v = loss_fn(model(Xva), Yva, Mva).item()

        if v < best_val:
            best_val = v
            best_state = {k: t.clone() for k, t in model.state_dict().items()}

        if ep % 10 == 0:
            print(f"epoch {ep:2d}  val loss {v:.4f}")

    print("best val loss:", round(best_val, 4))

    if best_state is not None:
        model.load_state_dict(best_state)
        os.makedirs(os.path.dirname(model_save_path) or ".", exist_ok=True)
        torch.save(best_state, model_save_path)

    return model, best_state, best_val
