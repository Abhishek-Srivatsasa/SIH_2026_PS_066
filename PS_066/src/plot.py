"""Visualisation utilities for OceanEmbed subsurface reconstructions.

Generates vertical temperature profile comparisons and horizontal temperature slice
maps comparing GLORYS reference ground truth against OceanEmbed model predictions.
"""

from typing import Optional
import matplotlib.pyplot as plt
import numpy as np
import torch
from .model import OceanEmbedNet

DEPTHS = [0.5, 5.1, 9.6, 18.5, 29.4, 47.4, 77.9, 92.3, 130.7, 155.9, 186.1, 318.1, 541.1, 643.6, 902.3]


def plot_prediction(
    day: int = 60,
    lat_target: float = 15.0,
    lon_target: float = 85.0,
    depth_idx: int = 8,
    prepared_data_path: str = "data/prepared.npz",
    model_path: str = "models/model.pt",
    save_path: Optional[str] = None,
    show: bool = True,
    device: Optional[str] = None,
) -> None:
    """Plot profile comparison and spatial temperature slices at selected depth.

    Args:
        day: Day index within held-out test period (0 to 60).
        lat_target: Latitude coordinate for vertical profile extraction (°N).
        lon_target: Longitude coordinate for vertical profile extraction (°E).
        depth_idx: Depth level index (0 to 14). Default 8 corresponds to 130.7 m.
        prepared_data_path: Path to prepared.npz.
        model_path: Path to model checkpoint.
        save_path: Optional file path to save plot image.
        show: Whether to display interactive plot window.
        device: 'cuda' or 'cpu'. Defaults to CUDA if available.
    """
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    d = np.load(prepared_data_path)
    Xn, Yn, M = d["Xn"], d["Yn"], d["M"]
    ntrain = int(d["ntrain"])
    mu_y, sd_y = d["mu_y"], d["sd_y"]
    lat, lon = d["lat"], d["lon"]

    model = OceanEmbedNet().to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    Xte = torch.tensor(Xn[ntrain:], dtype=torch.float32).to(device)
    with torch.no_grad():
        P = model(Xte).cpu().numpy()

    den = lambda a: a * sd_y + mu_y
    Pt = den(P)
    Tt = den(Yn[ntrain:])
    Mt = M[ntrain:]

    i = int(np.abs(lat - lat_target).argmin())
    j = int(np.abs(lon - lon_target).argmin())

    T = np.where(Mt[day, depth_idx] > 0, Tt[day, depth_idx], np.nan)
    P_map = np.where(Mt[day, depth_idx] > 0, Pt[day, depth_idx], np.nan)
    vmin, vmax = float(np.nanmin(T)), float(np.nanmax(T))

    fig, ax = plt.subplots(1, 3, figsize=(16, 5))
    ax[0].plot(Tt[day, :, i, j], DEPTHS, "k-o", label="GLORYS (truth)")
    ax[0].plot(Pt[day, :, i, j], DEPTHS, "r-o", label="OceanEmbed")
    ax[0].invert_yaxis()
    ax[0].set_xlabel("Temperature (°C)")
    ax[0].set_ylabel("Depth (m)")
    ax[0].set_title(f"Profile at {lat_target}°N, {lon_target}°E")
    ax[0].legend()

    for a, f, title in [(ax[1], T, "Truth"), (ax[2], P_map, "OceanEmbed")]:
        im = a.pcolormesh(lon, lat, f, vmin=vmin, vmax=vmax, cmap="turbo")
        a.set_title(f"{title} at {DEPTHS[depth_idx]} m")
        plt.colorbar(im, ax=a)

    plt.tight_layout()
    if save_path:
        plt.savefig(save_path, dpi=150)
    if show:
        plt.show()
    plt.close()
