# OceanEmbed

OceanEmbed reconstructs subsurface ocean temperature profiles (surface down to ~900 m across 15 standard depth levels) from surface ocean fields using a deep learning encoder-decoder network. Developed by Team SANKALP (#777) for Smart India Hackathon 2026, Problem Statement 26066 (Ministry of Earth Sciences, INCOIS).

## Scope and Honesty Statement

The prototype implementation in this repository is an early proof of concept.

### What it is
- A U-Net-style CNN encoder-decoder architecture mapping 5 surface variables to 15 subsurface depth levels.
- Five surface input channels: Sea Surface Temperature (SST), Sea Surface Salinity (SSS), Sea Surface Height (SSH), surface zonal current (uo), and surface meridional current (vo).
- Inputs are derived from the GLORYS12V1 physical reanalysis, not direct satellite swath products.
- Evaluated over a single 10° × 10° Bay of Bengal bounding box (80°E–90°E, 10°N–20°N).
- Daily temporal coverage from January to June 2021, coarsened from 1/12° to 0.25° grid resolution.
- 120 training days (January to April 2021) and 61 strictly held-out test days (May to June 2021).
- Benchmark comparison against a temporal baseline calculated from the January–April mean at each grid cell and depth.

### What it is NOT (Planned Work)
- **NOT** a Vision Transformer (ViT) architecture.
- **NOT** conditioned on geographic basin or salinity-derived stratification signals.
- **NOT** yet validated against in-situ ARGO profiling floats.
- **NOT** covering the Arabian Sea or the broader North Indian Ocean domain (5°N–30°N, 45°E–105°E).
- **NOT** using surface wind forcing vectors (CCMP / ASCAT).
- **NOT** an operational near-real-time forecasting system.

All non-implemented components above are tracked under the **Planned Work** section below.

## Real Held-Out Results (May–June 2021)

Model evaluation on 61 unseen held-out days across the Bay of Bengal box:

| Depth (m) | RMSE (°C) | Bias (°C) | Baseline RMSE (°C) | Anomaly Correlation |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 | 0.50 | -0.16 | 2.29 | 0.75 |
| 5.1 | 0.58 | -0.37 | 2.33 | 0.75 |
| 9.6 | 0.58 | -0.38 | 2.29 | 0.75 |
| 18.5 | 0.60 | -0.42 | 2.18 | 0.72 |
| 29.4 | 0.75 | -0.57 | 1.95 | 0.53 |
| 47.4 | 0.74 | -0.45 | 1.25 | 0.42 |
| 77.9 | 0.65 | 0.17 | 1.21 | 0.85 |
| 92.3 | 0.87 | 0.35 | 1.66 | 0.88 |
| 130.7 | 0.98 | 0.47 | 1.91 | 0.90 |
| 155.9 | 0.83 | 0.38 | 1.64 | 0.89 |
| 186.1 | 0.64 | 0.27 | 1.25 | 0.89 |
| 318.1 | 0.29 | 0.10 | 0.41 | 0.70 |
| 541.1 | 0.19 | 0.04 | 0.27 | 0.56 |
| 643.6 | 0.19 | 0.02 | 0.25 | 0.53 |
| 902.3 | 0.19 | 0.00 | 0.22 | 0.53 |

*Performance notes:*
- The Jan–Apr baseline is inherently weak because May–June in the Bay of Bengal is substantially warmer due to pre-monsoon heating. Anomaly correlation is therefore the fairer and more rigorous metric.
- The model is weakest between 30 m and 50 m depth, near the base of the seasonal mixed layer and upper thermocline where vertical gradients are sharp.
- Reconstructed spatial maps at 130.7 m reproduce major mesoscale warm and cool eddies, though fine boundary details are smoothed.

## Repository Structure

```text
├── .github/
│   └── workflows/
│       └── pages.yml           # GitHub Pages deployment workflow
├── docs/
│   ├── whitepaper.docx         # Project whitepaper documentation
│   └── images/                 # Evaluation figures and map comparisons
├── models/
│   └── model.pt                # Trained PyTorch model weights (1.1 MB)
├── notebooks/
│   └── oceanembed_poc.ipynb    # Cleaned reproducible Jupyter notebook
├── site/                       # Static showcase site for GitHub Pages
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── assets/
├── src/
│   ├── __init__.py
│   ├── data.py                 # Copernicus Marine ingestion and coarsening
│   ├── model.py                # OceanEmbedNet architecture and custom loss
│   ├── train.py                # Training and validation loop
│   ├── evaluate.py             # Metric computation over test slice
│   └── plot.py                 # Profile and horizontal slice plotting
├── .gitignore
├── LICENSE                     # MIT License
├── README.md
└── requirements.txt
```

## How to Reproduce

### 1. Installation
Clone the repository and install required packages in a Python 3.10+ environment:
```bash
git clone [ADD: repository URL]
cd PS_066
pip install -r requirements.txt
```

### 2. Copernicus Marine Authentication
Downloading GLORYS reanalysis files requires a free account on the Copernicus Marine Service:
```bash
copernicusmarine login
```

### 3. Execution Order
1. **Download and preprocess data**:
   ```python
   from src.data import download_glorys_subset, prepare_dataset
   download_glorys_subset(output_dir="data")
   prepare_dataset(data_dir="data", output_path="data/prepared.npz")
   ```
2. **Train the network**:
   ```python
   from src.train import train_model
   train_model(prepared_data_path="data/prepared.npz", model_save_path="models/model.pt")
   ```
3. **Evaluate held-out test metrics**:
   ```python
   from src.evaluate import evaluate_model
   results = evaluate_model(prepared_data_path="data/prepared.npz", model_path="models/model.pt")
   ```
4. **Plot reconstructed profiles and maps**:
   ```python
   from src.plot import plot_prediction
   plot_prediction(day=60, lat_target=15.0, lon_target=85.0, depth_idx=8, save_path="docs/images/evaluation_overview.png")
   ```

Alternatively, open and run `notebooks/oceanembed_poc.ipynb`.

## Planned Work

- **Real satellite inputs and wind stress**: Transition from GLORYS surface fields to Level-3/Level-4 satellite swath observations (OSTIA SST, SMAP/SMOS SSS, DUACS SSH, OSCAR currents, and CCMP/ASCAT winds).
- **Vision Transformer (ViT) variant**: Benchmark spatial-attention transformers against the convolutional encoder-decoder backbone.
- **Basin conditioning**: Explicit geographic and salinity-stratification conditioning to account for differing dynamics between the Bay of Bengal and Arabian Sea.
- **Geographic domain expansion**: Broaden coverage to the full North Indian Ocean domain (5°N–30°N, 45°E–105°E).
- **In-situ ARGO validation**: Perform direct validation against independent held-out ARGO float profiles from the INCOIS Live Access Server.

## Team and Acknowledgments

- **Team**: Team SANKALP (#777)
- **Members**: [ADD: team member names]
- **Mentor / Guide**: [ADD: mentor names]
- **Institutional Context**: Smart India Hackathon 2026, Ministry of Earth Sciences, INCOIS Ocean Valley.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
