# Polo Champions UX Design Instructions

These instructions translate the attached British Polo visual references into a practical game UX direction for Polo Champions. Treat the references as art direction: premium polo atmosphere, cinematic broadcast energy, and readable gameplay. Do not copy platform badges, store logos, rating marks, or third-party marks directly.

## Product Pillars

1. **Premium British Polo**
   Use deep navy, ivory, gold, scarlet, and royal blue. The game should feel like a televised King's Cup match at a historic club, not a generic arcade field.

2. **Readable Match First**
   The ball, rider positions, goal posts, score, timer, stamina, and active tutorial objective must be visible within one glance. Decorative realism must never hide core gameplay.

3. **Broadcast Presentation**
   HUD panels should feel like live sports graphics: compact, anchored, high contrast, and calm. Avoid floating text stacks in the center of the play view except for temporary goals, fouls, or tutorial prompts.

4. **Horse and Rider Identity**
   Blue and red teams need instant silhouette/color recognition. Horse coats are cosmetic only; gameplay class/archetype must remain readable through HUD/radar labels.

5. **Skill-Sport Feel**
   Movement should feel like FIFA/2K style sports control: assisted enough to be playable, physical enough to reward timing, spacing, momentum, and body position.

## Visual System

- **Primary palette:** navy `#07121d`, royal blue `#0f3d82`, scarlet `#8b1e1e`, polo gold `#c99a45`, ivory `#f8f2dc`, turf green `#4c983b`.
- **Typography:** elegant serif for brand, score, match state, and ceremony; compact sans/serif hybrid treatment for functional HUD labels.
- **Borders:** thin gold rules, small corner details, no oversized thick frames during gameplay.
- **HUD materials:** translucent navy panels with gold trim and ivory text.
- **Field:** bright green bands, visible halfway line, goal posts, and a consistent white ball marker.
- **Loading screens:** cinematic full-bleed polo action composition, navy/gold loading bar, one concise tip.

## Core Screens

### Main Menu

- First viewport should sell the fantasy: British Polo, King's Cup, royal grounds, blue vs scarlet rivalry.
- Primary CTA should be the clearest action: Play / Start Training / Start Match.
- Secondary actions: Locker Room, Horses, Leaderboards, Settings.
- Avoid dense feature explanations. Use match-like data panels instead: club, level, currency, party, daily challenge.

### Lobby

- Left: party roster with team color and ready state.
- Right: server/map details and map preview.
- Bottom: large Ready and Start Match actions.
- Ping and connection state should be visible but quiet.

### Match HUD

- Top center: chukker, timer, score, teams.
- Bottom right: speed, gait, stamina.
- Bottom left: chat and radar.
- Center: only temporary state messages. Tutorial card must not permanently block ball/goal view.
- Radar must always show all riders and ball, even if 3D rendering fails.

### Locker Room

- Center hero: horse and rider preview.
- Left: horse coat, tack, leg wraps, horse stats.
- Right: player kit, helmet, boots, mallet, ball style.
- Purchase/equip should always show current coins and clear feedback.

## Gameplay UX Rules

- Ball readability beats realism: white ball, outline/glow/drop shadow, radar ping.
- Goals must be visible from the default camera.
- During kickoff/training, show both lines of riders and the ball channel.
- Never let the local horse body fill more than 20% of the camera view unless a deliberate cinematic camera is active.
- If 3D lighting or assets fail, preserve playable overlay/radar state.

## Physics Feel Targets

Use FIFA/2K-style sports handling as the goal:

- **Acceleration:** smooth second-order buildup, no instant top speed except dev mode.
- **Turning:** tight at low speed, wider at gallop, with visible banking/lean.
- **Stamina:** sprint/gallop should be useful but finite; recovery should reward pacing.
- **Ball:** turf resistance should stop weak touches, but hard shots should travel decisively.
- **Mallet contact:** generous swept hit volume, strong timing feedback, clear sound/visual strike.
- **Ride-off:** power archetype resists displacement, sprinter is easier to move, all-rounder is balanced.
- **AI:** roles must look intentional: attacker pressures ball, midfielder supports, defender guards goal line, sweeper protects deep space.

## Build Hacks and Testing Tricks

- Keep a deterministic 2D/broadcast overlay for gameplay QA. It reveals logic bugs even when 3D art breaks.
- Use a fixed kickoff formation test every build: two parallel lines, ball at center, goal posts visible.
- Add visual debug toggles for ball path, mallet sweep, and AI target point, but strip them in production.
- Tune movement with a three-step loop: start, turn, strike. If those feel good, the full match improves naturally.
- Do not debug camera, lighting, physics, and AI simultaneously. Freeze three systems and tune one.
- Record short test clips after each major change: kickoff, first sprint, first swing, first goal.
- Preserve keyboard-only play as the baseline. Gamepad/touch can be layered on top.

## Current Release-Test Position

The current production build uses a broadcast-readable field overlay as a gameplay safety layer. This is acceptable for release testing and QA, but not the final art target. The next production-quality step is to rebuild the 3D match camera and asset lighting so the real WebGL scene can replace the overlay without losing readability.
