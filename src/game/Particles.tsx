import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { useMatch } from "./GameState";

type Particle = { life: number; velocity: THREE.Vector3 };
/** Small fixed pool for divots, ball wake, and goal sparks. */
export function MatchParticles() {
  const group = useRef<THREE.Group>(null), pool = useRef<Particle[]>([]), lastGoal = useRef<"blue"|"red"|null>(null);
  const telemetry = useMatch(s => s.telemetry), goal = useMatch(s => s.celebratingGoal);
  useFrame((state, dt) => {
    if (!group.current) return;
    const spawn = (position: THREE.Vector3, velocity: THREE.Vector3, color: string) => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(.045, 5, 4), new THREE.MeshBasicMaterial({ color })); mesh.position.copy(position); group.current!.add(mesh); pool.current.push({ life: .7, velocity }); };
    if (telemetry.speed > 12 && Math.random() < dt * 16) spawn(new THREE.Vector3(telemetry.player.x, .1, telemetry.player.z), new THREE.Vector3((Math.random()-.5)*2,.8,Math.random()-.5), "#598542");
    if (Math.hypot(telemetry.ball.x, telemetry.ball.z) > 0 && telemetry.speed > 12 && Math.random() < dt * 6) spawn(new THREE.Vector3(telemetry.ball.x,.12,telemetry.ball.z), new THREE.Vector3(0,.12,0), "#e6e3d4");
    if (goal && lastGoal.current !== goal) for(let index=0;index<18;index+=1) spawn(new THREE.Vector3(0,1,goal === "blue" ? -42 : 42), new THREE.Vector3((Math.random()-.5)*6,Math.random()*4,(Math.random()-.5)*2), "#f5cf5b");
    lastGoal.current = goal;
    for (let index=pool.current.length-1; index>=0; index-=1) { const item=pool.current[index], mesh=group.current.children[index] as THREE.Mesh|undefined; item.life-=dt; if(mesh){mesh.position.addScaledVector(item.velocity,dt);item.velocity.y-=3*dt;mesh.scale.setScalar(Math.max(0,item.life));} if(item.life<=0&&mesh){group.current.remove(mesh);pool.current.splice(index,1);} }
  });
  return <group ref={group} name="match-particles" />;
}
