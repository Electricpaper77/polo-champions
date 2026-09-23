import * as THREE from 'three';

export interface AudienceOptions {
fieldWidth?: number;
fieldLength?: number;
crowdCount?: number;
}

export function createAudience(scene: THREE.Scene, options: AudienceOptions = {}) {
// Adjusted default field dimensions to fit active game field
const fieldWidth = options.fieldWidth ?? 65;
const fieldLength = options.fieldLength ?? 130;
const crowdCount = options.crowdCount ?? 600;

const audienceGroup = new THREE.Group();
audienceGroup.name = 'AudienceAndStadium';

// 1. Perimeter Side-Boards (Right along touchlines)
const boardMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 });
const boardGeo = new THREE.BoxGeometry(0.8, 0.6, fieldLength);

const leftBoard = new THREE.Mesh(boardGeo, boardMat);
leftBoard.position.set(-fieldWidth / 2 - 0.5, 0.3, 0);
audienceGroup.add(leftBoard);

const rightBoard = new THREE.Mesh(boardGeo, boardMat);
rightBoard.position.set(fieldWidth / 2 + 0.5, 0.3, 0);
audienceGroup.add(rightBoard);

// 2. VIP Canopy Tents along side lines
const tentMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.3 });
const tentGeo = new THREE.BoxGeometry(5, 3, 6);
const roofGeo = new THREE.ConeGeometry(4.5, 2, 4);

const numTents = 6;
const spacing = fieldLength / (numTents + 1);

for (const side of [-1, 1]) {
for (let i = 1; i <= numTents; i++) {
  const z = -fieldLength / 2 + i * spacing;
  const x = side * (fieldWidth / 2 + 8);

  const tent = new THREE.Mesh(tentGeo, tentMat);
  tent.position.set(x, 1.5, z);
  audienceGroup.add(tent);

  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(x, 4, z);
  roof.rotation.y = Math.PI / 4;
  audienceGroup.add(roof);
}
}

// 3. Instanced Spectators (Closer to touchlines)
const spectatorGeo = new THREE.BoxGeometry(0.5, 1.4, 0.5);
const spectatorMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
const crowdMesh = new THREE.InstancedMesh(spectatorGeo, spectatorMat, crowdCount);

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const palette = [0x2563eb, 0xd97706, 0xdc2626, 0x16a34a, 0x9333ea, 0xdb2777, 0xf8fafc, 0x1e293b];

for (let i = 0; i < crowdCount; i++) {
const side = Math.random() > 0.5 ? 1 : -1;
const x = side * (fieldWidth / 2 + 2 + Math.random() * 10);
const z = (Math.random() - 0.5) * (fieldLength * 0.95);

const dist = Math.abs(x) - fieldWidth / 2;
const y = 0.7 + dist * 0.1;

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