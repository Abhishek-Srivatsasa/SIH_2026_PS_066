"""OceanEmbed: Deep learning framework for ocean subsurface temperature reconstruction."""

from .model import OceanEmbedNet, loss_fn
from .data import download_glorys_subset, coarsen, prepare_dataset
from .train import train_model
from .evaluate import evaluate_model
from .plot import plot_prediction

__all__ = [
    "OceanEmbedNet",
    "loss_fn",
    "download_glorys_subset",
    "coarsen",
    "prepare_dataset",
    "train_model",
    "evaluate_model",
    "plot_prediction",
]
