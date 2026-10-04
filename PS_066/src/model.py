"""Neural network architectures for OceanEmbed subsurface reconstruction.

Implements OceanEmbedNet: a U-Net convolutional encoder-decoder mapping 5 surface
ocean channels (SST, SSS, SSH, U current, V current) to 15 subsurface depth levels
down to ~900 m via a 128-channel latent embedding with skip connections.
"""

import torch
import torch.nn as nn


def block(in_channels: int, out_channels: int) -> nn.Sequential:
    """Convolutional building block: 3x3 Conv2d -> BatchNorm2d -> GELU activation."""
    return nn.Sequential(
        nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1),
        nn.BatchNorm2d(out_channels),
        nn.GELU(),
    )


class OceanEmbedNet(nn.Module):
    """U-Net convolutional encoder-decoder for ocean subsurface temperature reconstruction.

    Inputs:
        Tensor of shape (B, 5, H, W) containing normalised surface fields:
        [SST, SSS, SSH, surface U current, surface V current].

    Outputs:
        Tensor of shape (B, 15, H, W) containing predicted temperatures across
        the 15 target depth levels.
    """

    def __init__(self) -> None:
        super().__init__()
        # Encoder stages
        self.e1 = nn.Sequential(block(7, 32), block(32, 32))
        self.e2 = nn.Sequential(nn.MaxPool2d(2), block(32, 64), block(64, 64))
        self.e3 = nn.Sequential(nn.MaxPool2d(2), block(64, 128))  # Latent embedding: 128 channels

        # Decoder stages with skip connections
        self.u2 = nn.ConvTranspose2d(128, 64, kernel_size=2, stride=2)
        self.d2 = block(128, 64)
        self.u1 = nn.ConvTranspose2d(64, 32, kernel_size=2, stride=2)
        self.d1 = block(64, 32)

        # Output head: 15 depth levels
        self.head = nn.Conv2d(32, 15, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, C, H, W = x.shape
        device = x.device
        
        # Geographic Conditioning: Create normalized Lat/Lon meshgrid
        y_grid = torch.linspace(-1, 1, H, device=device).view(1, 1, H, 1).expand(B, 1, H, W)
        x_grid = torch.linspace(-1, 1, W, device=device).view(1, 1, 1, W).expand(B, 1, H, W)
        
        # Concatenate 2 coordinate channels with 5 surface channels
        x_aug = torch.cat([x, y_grid, x_grid], dim=1)

        a = self.e1(x_aug)
        b = self.e2(a)
        z = self.e3(b)
        y = self.d2(torch.cat([self.u2(z), b], dim=1))
        y = self.d1(torch.cat([self.u1(y), a], dim=1))
        return self.head(y)


def loss_fn(p: torch.Tensor, y: torch.Tensor, m: torch.Tensor) -> torch.Tensor:
    """Masked MSE loss combined with a vertical consistency gradient penalty.

    Args:
        p: Predicted normalised fields (B, 15, H, W).
        y: Ground-truth normalised fields (B, 15, H, W).
        m: Binary ocean validity mask (B, 15, H, W) (1=valid ocean, 0=land/seafloor).

    Returns:
        Scalar training loss.
    """
    mse = ((p - y) ** 2 * m).sum() / m.sum()
    dp = p[:, 1:] - p[:, :-1]
    dy = y[:, 1:] - y[:, :-1]
    mv = m[:, 1:] * m[:, :-1]
    return mse + 0.5 * (((dp - dy) ** 2 * mv).sum() / mv.sum())
