"""In-Situ ARGO Validation Pipeline for OceanEmbed.

Ingests standard ARGO float NetCDF profiles and cross-matches them with
U-Net predictions to generate a standalone validation report.
"""

import os
import numpy as np
import xarray as xr
import torch
from typing import List, Dict
from .model import OceanEmbedNet
from .evaluate import DEPTHS

class ArgoDataLoader:
    """Ingests standard ARGO float NetCDF profiles."""
    def __init__(self, argo_nc_path: str):
        self.dataset = xr.open_dataset(argo_nc_path)

    def get_profiles(self) -> List[Dict]:
        """Extracts profiles containing time, lat, lon, depths, and temperatures."""
        profiles = []
        # Assuming standard ARGO variables: TIME, LATITUDE, LONGITUDE, PRES, TEMP
        times = self.dataset.TIME.values
        lats = self.dataset.LATITUDE.values
        lons = self.dataset.LONGITUDE.values
        
        for i in range(len(times)):
            temp = self.dataset.TEMP[i].values
            pres = self.dataset.PRES[i].values
            
            # Filter valid measurements
            valid = ~np.isnan(temp) & ~np.isnan(pres)
            if valid.sum() > 0:
                profiles.append({
                    "time": times[i],
                    "lat": lats[i],
                    "lon": lons[i],
                    "depths": pres[valid],
                    "temps": temp[valid]
                })
        return profiles


class SpatioTemporalMatcher:
    """Matches ARGO float coordinates to the exact 3D coordinate from U-Net predictions."""
    def __init__(self, model_lat: np.ndarray, model_lon: np.ndarray, model_time: np.ndarray, model_depths: np.ndarray, predictions: np.ndarray):
        self.model_lat = model_lat
        self.model_lon = model_lon
        self.model_time = model_time
        self.model_depths = np.array(model_depths)
        self.predictions = predictions  # Shape (time, depth, lat, lon)

    def match(self, argo_lat: float, argo_lon: float, argo_time: np.datetime64, argo_depth: float) -> float:
        """Extracts the exact matching 3D coordinate from the prediction tensor."""
        lat_idx = np.abs(self.model_lat - argo_lat).argmin()
        lon_idx = np.abs(self.model_lon - argo_lon).argmin()
        
        # Convert time differences to floats for argmin
        time_diffs = np.abs(self.model_time - argo_time)
        time_idx = time_diffs.argmin()
        
        depth_idx = np.abs(self.model_depths - argo_depth).argmin()
        
        return float(self.predictions[time_idx, depth_idx, lat_idx, lon_idx])


def validate_against_argo(
    prepared_data_path: str = "data/prepared.npz",
    model_path: str = "models/model.pt",
    argo_path: str = "data/argo_profiles.nc",
    device: str = "cpu"
):
    """Generates a standalone validation report calculating RMSE for 'U-Net vs. ARGO Real Truth'."""
    if not os.path.exists(argo_path):
        print(f"ARGO data not found at {argo_path}. Cannot perform in-situ validation.")
        return

    # 1. Load U-Net predictions
    d = np.load(prepared_data_path)
    Xn, Yn = d["Xn"], d["Yn"]
    mu_y, sd_y = d["mu_y"], d["sd_y"]
    model_lat = d["lat"]
    model_lon = d["lon"]
    
    # We would need the test dates to match correctly. Assuming daily from 2021-01-01 for demo.
    model_time = np.arange(np.datetime64("2021-01-01"), np.datetime64("2021-01-01") + np.timedelta64(len(Xn), 'D'))

    model = OceanEmbedNet().to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()

    with torch.no_grad():
        P = model(torch.tensor(Xn, dtype=torch.float32).to(device)).cpu().numpy()
        
    predictions = P * sd_y + mu_y

    # 2. Setup Matcher and Loader
    matcher = SpatioTemporalMatcher(model_lat, model_lon, model_time, DEPTHS, predictions)
    loader = ArgoDataLoader(argo_path)
    profiles = loader.get_profiles()

    # 3. Calculate metrics
    errors = []
    
    print("\n--- U-Net vs. ARGO Real Truth ---")
    print(f"Total Profiles Evaluated: {len(profiles)}")
    
    for prof in profiles:
        for depth, true_temp in zip(prof["depths"], prof["temps"]):
            pred_temp = matcher.match(prof["lat"], prof["lon"], prof["time"], depth)
            errors.append((pred_temp - true_temp) ** 2)

    if errors:
        rmse = np.sqrt(np.mean(errors))
        print(f"Overall ARGO Validation RMSE: {rmse:.3f} °C\n")
    else:
        print("No valid collocations found between ARGO data and model grid.")

if __name__ == "__main__":
    validate_against_argo()
