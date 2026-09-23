import * as THREE from 'three';

export interface AudienceOptions {
fieldWidth?: number;
fieldLength?: number;
crowdCount?: number;
}

export function createAudience(scene: THREE.Scene, options: AudienceOptions = {}) {
// Matched to camera frustum visible on screen
const fieldWidth = options.fieldWidth ?? 36;
const fieldLength = options.fieldLength ?? 120;
const crowdCount = options.crowdCount ?? 500;

const audienceGroup = new THREE.Group();
audienceGroup.name = 'AudienceAndStadium';

// 1. Perimeter Side-Boards (Visible touchlines at x = +-18)
const boardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
const boardGeo = new THREE.BoxGeometry(0.6, 0.8, fieldLength);

const leftBoard = new THREE.Mesh(boardGeo, boardMat);
leftBoard.position.set(-fieldWidth / 2 - 0.3, 0.4, 0);
audienceGroup.add(leftBoard);

const rightBoard = new THREE.Mesh(boardGeo, boardMat);
rightBoard.position.set(fieldWidth / 2 + 0.3, 0.4, 0);
audienceGroup.add(rightBoard);

// 2. VIP Canopy Tents (Just outside sideboards at x = +-22)
const tentMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.3 });
const tentGeo = new THREE.BoxGeometry(4, 2.8, 5);
const roofGeo = new THREE.ConeGeometry(3.5, 1.8, 4);

const numTents = 6;
const spacing = fieldLength / (numTents + 1);

for (const side of [-1, 1]) {
for (let i = 1; i <= numTents; i++) {
  const z = -fieldLength / 2 + i * spacing;
  const x = side * (fieldWidth / 2 + 4);

  const tent = new THREE.Mesh(tentGeo, tentMat);
  tent.position.set(x, 1.4, z);
  audienceGroup.add(tent);

  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(x, 3.7, z);
  roof.rotation.y = Math.PI / 4;
  audienceGroup.add(roof);
}
}

// 3. Instanced Spectators (Visible crowd at x = +-19.5 to +-26)
const spectatorGeo = new THREE.BoxGeometry(0.5, 1.5, 0.5);
const spectatorMat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
const crowdMesh = new THREE.InstancedMesh(spectatorGeo, spectatorMat, crowdCount);

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const palette = [0x2563eb, 0xd97706, 0xdc2626, 0x16a34a, 0x9333ea, 0xdb2777, 0xf8fafc, 0x1e293b];

for (let i = 0; i < crowdCount; i++) {
const side = Math.random() > 0.5 ? 1 : -1;
const x = side * (fieldWidth / 2 + 1.5 + Math.random() * 7);
const z = (Math.random() - 0.5) * (fieldLength * 0.95);

const dist = Math.abs(x) - fieldWidth / 2;
const y = 0.75 + dist * 0.1;

dummy.position.set(x, y, z);
dummy.rotation.y = side < 0 ? Math.PI / 2 + (Math.random() - 0.5) * 0.4 : -Math.PI / 2 + (Math.random() - 0.5) * 0.4;
dummy.scale.set(0.9 + Math.random() * 0.2, 0.85 + Math.random() * 0.3, 0.9 + Math.random() * 0.2);
dummy.updateMatrix();

crowdMesh.setMatrixAt(i, dummy.matrix);
color.setHex(palette[Math.floor(Math.random() * palette.length)]);
crowdMesh.setColorAt(i, color);
}

crowdMesh.instanceMatrix.needsUpdate = true;
if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;

audienceGroup.add(crowdMesh);
scene.add(audienceGroup);

return audienceGroup;
}