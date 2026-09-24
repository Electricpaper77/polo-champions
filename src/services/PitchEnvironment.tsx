import * as THREE from 'three';

export interface AudienceOptions {
fieldWidth?: number;
fieldLength?: number;
crowdCount?: number;
}

export function createAudience(scene: THREE.Scene, options: AudienceOptions = {}) {
console.log('🏇 Audience.ts: Executing createAudience on scene', scene);

// Field width set to 24 (side-boards at x = +-12.3, right past outer horses)
const fieldWidth = options.fieldWidth ?? 24;
const fieldLength = options.fieldLength ?? 120;
const crowdCount = options.crowdCount ?? 500;

const audienceGroup = new THREE.Group();
audienceGroup.name = 'AudienceAndStadium';

// 1. Perimeter Side-Boards (Elevated white boards along touchlines)
const boardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
const boardGeo = new THREE.BoxGeometry(0.5, 0.8, fieldLength);

const leftBoard = new THREE.Mesh(boardGeo, boardMat);
leftBoard.position.set(-fieldWidth / 2 - 0.3, 0.4, 0);
audienceGroup.add(leftBoard);

const rightBoard = new THREE.Mesh(boardGeo, boardMat);
rightBoard.position.set(fieldWidth / 2 + 0.3, 0.4, 0);
audienceGroup.add(rightBoard);

// 2. VIP Canopy Tents (Positioned at x = +-15.5)
const tentMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.3 });
const tentGeo = new THREE.BoxGeometry(3.5, 2.5, 4.5);
const roofGeo = new THREE.ConeGeometry(3, 1.5, 4);

const numTents = 6;
const spacing = fieldLength / (numTents + 1);

for (const side of [-1, 1]) {
for (let i = 1; i <= numTents; i++) {
  const z = -fieldLength / 2 + i * spacing;
  const x = side * (fieldWidth / 2 + 3.5);

  const tent = new THREE.Mesh(tentGeo, tentMat);
  tent.position.set(x, 1.25, z);
  audienceGroup.add(tent);

  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(x, 3.25, z);
  roof.rotation.y = Math.PI / 4;
  audienceGroup.add(roof);
}
}

// 3. Instanced Spectators (Positioned at x = +-13.5 to +-18.5)
const spectatorGeo = new THREE.BoxGeometry(0.45, 1.4, 0.45);
const spectatorMat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
const crowdMesh = new THREE.InstancedMesh(spectatorGeo, spectatorMat, crowdCount);

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const palette = [0x2563eb, 0xd97706, 0xdc2626, 0x16a34a, 0x9333ea, 0xdb2777, 0xf8fafc, 0x1e293b];

for (let i = 0; i < crowdCount; i++) {
const side = Math.random() > 0.5 ? 1 : -1;
const x = side * (fieldWidth / 2 + 1.2 + Math.random() * 5);
const z = (Math.random() - 0.5) * (fieldLength * 0.95);

const dist = Math.abs(x) - fieldWidth / 2;
const y = 0.7 + dist * 0.12;

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

console.log('✅ Audience successfully added to scene with width', fieldWidth);
return audienceGroup;
}