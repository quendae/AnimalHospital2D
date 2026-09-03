# Animal Hospital: Night Shift Cards

A 108-card, UNO-style deck concept for the AnimalHospital2D project. The deck deliberately keeps familiar four-color/action-card readability while replacing generic card decoration with Animal Hospital motifs.

## Preview

Run the client and open it with:

`?cards=1`

The gallery shows the complete deck in pages. Use the left/right buttons or arrow keys.

## Theme mapping

- **Red — Enemies:** Bed Monster, Stalker, Mass of Eyes, Hiders, Skinwalker, Head Banger, Tendril, Camera Figure, Ghost, Surgery Monster.
- **Yellow — Anomalies:** mismatched/sharp features, Three Eyes, Hollow Face, Unnatural Face, Twitching, Hunched Posture, Static Photo, Black Eyes, Camera Stare, Void Patient.
- **Green — Classes:** Intern, Nurse, Secretary, Paramedic, Psychologist, Doctor, Security, Head Nurse, Surgeon, Secret Agent.
- **Blue — Characters:** Dr. Harlow, Barney, Ratthew, Ron from Accounting, Officer Duckman and patients.
- **Wild — Night Shift:** Dr. Harlow's Call / Hospital Emergency.

The thematic words and illustrations are secondary to the large number/action glyph, so the cards remain readable while playing.

## Action cards

Each color has its own Animal Hospital wording without changing the underlying action:

| Action | Examples |
| --- | --- |
| Skip | Lockdown, Bad Photo, Security Hold, Do Not Enter |
| Reverse | Shapeshift, Check CCTV, Reroute, Paperwork |
| Draw 2 | Don't Look Up, Double Check, Extra Duty, Coffee Run |
| Wild | Dr. Harlow's Call |
| Wild +4 | Night Shift |

## Source references

Concept/name references were taken from the Animal Hospital community wiki pages supplied for this task:

- https://animal-hospital.fandom.com/wiki/Anomalies
- https://animal-hospital.fandom.com/wiki/Characters
- https://animal-hospital.fandom.com/wiki/Classes
- https://animal-hospital.fandom.com/wiki/Enemies

The card composition, icons, typography, palette treatment and Phaser rendering are original for AnimalHospital2D; wiki images are not copied into the repository.

## Files

- `apps/client/src/cards/AnimalHospitalUnoDeck.ts` — deck definition and reusable Phaser card renderer.
- `apps/client/src/scenes/CardGalleryScene.ts` — visual gallery/review scene.
- `apps/client/src/main.ts` — `?cards=1` entry point.
