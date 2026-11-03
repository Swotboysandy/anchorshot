"""Local optical-flow proposals; no semantic recognition or automatic approval.

OpenCV Farneback reference: https://docs.opencv.org/4.x/dc/d6b/group__video__track.html
Reviewed frames reset propagation. Empty/occluded objects need explicit review or a
new visible seed; this algorithm does not claim semantic re-identification.
"""
import base64, hashlib, json, sys
from pathlib import Path
import cv2
import numpy as np


def propagate(folder, manifest, track):
    images, masks, seeds = [], {}, {}
    for frame in manifest["frames"]:
        raw = (folder / f"frame-{frame['index']:03}.png").read_bytes()
        if hashlib.sha256(raw).hexdigest() != frame["sourceHash"]:
            raise ValueError("Source frame changed; reload the clip.")
        image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.shape[:2] != (frame["height"], frame["width"]):
            raise ValueError("Invalid source frame dimensions.")
        images.append(image)
    height, width = images[0].shape[:2]
    for entry in track["frames"]:
        if entry.get("reviewed") is True:
            mask = np.frombuffer(base64.b64decode(entry["maskBase64"], validate=True), np.uint8)
            if mask.size != width * height or np.any(mask > 1):
                raise ValueError("Invalid reviewed mask.")
            masks[entry["frameIndex"]] = mask.reshape(height, width).copy()
            seeds[entry["frameIndex"]] = entry
    if not seeds:
        raise ValueError("Review at least one visible or absent frame first.")
    grid_x, grid_y = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    result = dict(seeds)

    def step(previous_index, index):
        previous, current = images[previous_index], images[index]
        previous_gray = cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)
        current_gray = cv2.cvtColor(current, cv2.COLOR_BGR2GRAY)
        backward = cv2.calcOpticalFlowFarneback(current_gray, previous_gray, None, .5, 4, 21, 4, 7, 1.5, 0)
        forward = cv2.calcOpticalFlowFarneback(previous_gray, current_gray, None, .5, 4, 21, 4, 7, 1.5, 0)
        map_x, map_y = grid_x + backward[:, :, 0], grid_y + backward[:, :, 1]
        warped = cv2.remap(masks[previous_index], map_x, map_y, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT)
        forward_at_source = cv2.remap(forward, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        roundtrip = np.linalg.norm(backward + forward_at_source, axis=2)
        reliable = (roundtrip < 1.5) & (map_x >= 0) & (map_y >= 0) & (map_x < width) & (map_y < height)
        mask = ((warped > 0) & reliable).astype(np.uint8)
        masks[index] = mask
        count = int(mask.sum())
        note = "Motion proposal; review the visible object boundary."
        if count < 16:
            note = "Object lost or occluded. Mark absent, or select it again if visible."
        elif count < int(masks[previous_index].sum()) * .65:
            note = "Selection shrank; check occlusion and missing parts."
        prior = next((entry for entry in track["frames"] if entry["frameIndex"] == index), None)
        result[index] = {"frameIndex": index, "sourceHash": manifest["frames"][index]["sourceHash"],
            "maskBase64": base64.b64encode(mask.tobytes()).decode(), "revision": (prior or {}).get("revision", 0) + 1,
            "reviewed": False, "absent": False, "method": "optical-flow", "proposalNote": note}

    # Preserve every reviewed correction, using it as a new motion anchor.
    start = min(seeds)
    for index in range(start + 1, len(images)):
        if index not in seeds:
            step(index - 1, index)
    for index in range(start - 1, -1, -1):
        step(index + 1, index)
    return {**track, "frames": [result[index] for index in range(len(images))]}


if __name__ == "__main__":
    request = json.load(sys.stdin)
    print(json.dumps(propagate(Path(sys.argv[1]), request["manifest"], request["track"])))
