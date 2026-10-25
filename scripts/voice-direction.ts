/**
 * How the mission dialogue is performed: who plays each speaker, and how each line is said.
 * scripts/generate-voice-lines.ts reads this to record the lines with ElevenLabs.
 *
 * CAST gives every speaker one of ElevenLabs' stock voices (present on every account) and a
 * note on who they are. DIRECTION is the acting: the line as written in the catalog, mapped to
 * the same words with eleven_v4 audio tags ([sighs], [nervous], [whispers]...) and the pauses
 * and stresses a person would put in. Only the recording hears it; subtitles stay as written.
 * A line with no direction is read plainly in its speaker's voice. Change a line here or in the
 * catalog and only that line is recorded again.
 */

export interface Casting {
	/** An ElevenLabs voice id. */
	voice: string;
	/** Who they are, for whoever recasts them. */
	note: string;
	/**
	 * Stability: 0 "creative" (the most feeling, now and then too much), 0.5
	 * "natural", 1 "robust" (steady, flatter).
	 */
	stability?: 0 | 0.5 | 1;
}

export const CAST: Record<string, Casting> = {
	Benny: { voice: "pqHfZKP75CvOlQylNhV4", note: "Bill. Old car dealer, gravel and warmth; calls the player kid, worries more than he admits." },
	Dez: { voice: "TX3LPaxmHKxFdv7VOQHJ", note: "Liam. Benny's nephew, young, jittery, all bravado until it cracks.", stability: 0 },
	Marisol: { voice: "EXAVITQu4vr4xnSDxMaL", note: "Sarah. Tenants' organiser in Sunset Park; steady, dry, tired of being pushed." },
	Static: { voice: "IKne3meq5aSn9XLyUdCD", note: "Charlie. Scanner-and-logs hacker; quick, wry, mutters along as he reads.", stability: 0 },
	Kincaid: { voice: "nPczCjzI2devNBz1zQrb", note: "Brian. Detective, clipped and dry, a sliver of humour under the badge." },
	"Silas Crane": { voice: "JBFqnCBsd6RMkjVDRZzb", note: "George. Respectable villain, smooth and unhurried, used to buying his way out." },
	Jax: { voice: "N2lVS1w4EtoT3dr4eOWO", note: "Callum. Crane's driver, cocky and sly, holds a grudge with a smile." },
	"Unknown caller": { voice: "N2lVS1w4EtoT3dr4eOWO", note: "Jax, before you've met him." },
	Quill: { voice: "onwK4e9ZLuTAKqWW03F9", note: "Daniel. Eccentric collector, theatrical, delighted by Crane's misfortune." },
	Rosa: { voice: "cgSgspJ2msm6clMCkdW9", note: "Jessica. Street-race organiser, cocky, teasing, secretly impressed." },
	"Capt. Brandt": { voice: "cjVigY5qzO86Huf0OWal", note: "Eric. Pilot instructor, gruff, protective of the jet." },
	"Maj. Vos": { voice: "Xb7hH8MSUJpSbSDYk0k2", note: "Alice. Military officer, cool command, suspicious of everyone.", stability: 1 },
	Nia: { voice: "XrExE9yKIg1WjnnlVkGX", note: "Matilda. Paramedic, calm under pressure until it's life or death." },
	Dispatch: { voice: "SAz9YHcvj6GT2YYXdXww", note: "River. Radio dispatcher, level and practised.", stability: 1 },
	Lena: { voice: "pFZP5JQG7iQjIQuC4Bku", note: "Lily. Safecracker, sly, unflappable, enjoys the work a bit too much." },
	Attendant: { voice: "bIHbv24MWmeRgasZH58o", note: "Will. Night attendant at the hospital, chatty, amused." },
	"Meridian guard": { voice: "CwhRBWXzGAHq8TQ4Fs17", note: "Roger. A guard who just saw something he shouldn't." },
};

/** Catalog text → the same line as it should be performed. */
export const DIRECTION: Record<string, string> = {
	// Benny
	"Keys are in it. Go, go!": "[urgent] Keys are in it. Go — go!",
	"He's a pro — he won't stop for a honk. Put him into something.": "[frustrated] He's a pro... he won't stop for a honk. [strained] Put him into something.",
	"He's stopped! Get my client's car before he gets ideas.": "[excited] He's stopped! [urgent] Get my client's car before he gets ideas.",
	"Bring her home. Gently. Ish.": "[relieved sigh] Bring her home. Gently. [chuckles] Ish.",
	"If he makes the Ghats Expressway, he's gone. Stop him in town.": "[worried] If he makes the Ghats Expressway, he's gone. Stop him in town.",
	"He's on the expressway ramp — now or never, kid!": "[shouting] He's on the expressway ramp — now or never, kid!",
	"Glovebox is empty. Whatever he wanted, he got it before you caught him.": "[puzzled] Glovebox is empty. [quietly] Whatever he wanted... he got it before you caught him.",
	"These plates are Meridian Logistics fleet. Silas Crane's people. Huh.": "[slowly] These plates are Meridian Logistics fleet. Silas Crane's people. [uneasy] Huh.",
	"Kid — you're the new driver? Good timing. Somebody just drove my client's silver Vesper off my lot. Take my car, catch him, and bring it back.": "[flustered] Kid — you're the new driver? Good timing. [exasperated] Somebody just drove my client's silver Vesper right off my lot. Take my car, catch him, and bring it back.",
	"Bent is fine. Gone is not.": "[firmly] Bent is fine. [pause] Gone is not.",
	"That's the alarm. Lose the boys in blue before Hillcrest — the neighbours talk.": "[pained] That's the alarm. Lose the boys in blue before Hillcrest — [dry] the neighbours talk.",
	"Garage is yours. Anything you earn, you park there. Welcome to the family business.": "[warmly] Garage is yours. Anything you earn, you park there. [proud] Welcome to the family business.",
	"Crane's people will be watching my lot now, so this client's sedan goes up to your new place in Hillcrest. Yes, kid — the house is yours, a thank-you.": "[conspiratorial] Crane's people will be watching my lot now, so this client's sedan goes up to your new place in Hillcrest. [warmly] Yes, kid — the house is yours. A thank-you.",
	"It's alarmed, so the cops will come running. Lose them first, keep it pretty, and be quick.": "It's alarmed, so the cops will come running. Lose them first, keep it pretty... [hurried] and be quick.",
	"My own nephew. ...Thank you for telling me straight, kid.": "[heartbroken, quietly] My own nephew. [long pause] [voice breaking] ...Thank you for telling me straight, kid.",
	"Crane's had enough of Sunset Park making noise. Static heard it on the scanner: they've taken Marisol up to the Ghats lookout. Bring her home, kid.": "[grim] Crane's had enough of Sunset Park making noise. Static heard it on the scanner — they've taken Marisol up to the Ghats lookout. [pleading] Bring her home, kid.",
	"Quiet if you can, but bring her home.": "[softly] Quiet if you can. [firm] But bring her home.",
	"Gear's in the back. Don't scratch it. Kidding. Scratch it all you like tonight.": "Gear's in the back. Don't scratch it. [laughs] Kidding. [darkly amused] Scratch it all you like tonight.",
	"You took his money. I'm not judging. I'm just... noting it.": "[disappointed] You took his money. [sighs] I'm not judging. I'm just... noting it.",
	"Kasper Motors is open for business. And you, kid, are a partner.": "[proud, emotional] Kasper Motors is open for business. [warmly] And you, kid... are a partner.",
	"Crane knows it's you. So we end it tonight: his office on the arterial, his guards, his getaway. Take my car.": "[serious] Crane knows it's you. So we end it tonight. His office on the arterial, his guards, his getaway. [resolute] Take my car.",
	"Whatever you decide about him at the end — decide it like you'll have to live here after.": "[gently, fatherly] Whatever you decide about him at the end... decide it like you'll have to live here after.",
	"Best box-cracker in the city. Bring her back in one piece, kid. Both of you, ideally.": "[proud] Best box-cracker in the city. [worried] Bring her back in one piece, kid. [chuckles nervously] Both of you, ideally.",
	"Lena, the guards are Crane's, not cops. Keep it that way — cops get expensive.": "[stern] Lena, the guards are Crane's, not cops. Keep it that way — [sighs] cops get expensive.",
	"Look at that. Crane's money, in my garage. That's going to make him angry.": "[delighted laugh] Look at that. Crane's money, in my garage. [gleeful] That's going to make him angry.",
	"Meridian took a car off my lot, so we take something off theirs. They count their dirty cash behind a payday-loan shop on the commercial strip.": "[bitter] Meridian took a car off my lot... so we take something off theirs. [lower] They count their dirty cash behind a payday-loan shop on the commercial strip.",
	"Lena opens the cage, you drive and keep her breathing. The cops will come, so there's a clean car waiting in a lockup by the port. In, out, home.": "Lena opens the cage, you drive and keep her breathing. The cops will come, so there's a clean car waiting in a lockup by the port. [firmly] In, out, home.",

	// Dez
	"Oh, that's a lot of sirens. That's fine! That's the job!": "[panicked] Oh, that's — that's a lot of sirens. [nervous laugh] That's fine! That's the job!",
	"Ha! Tell Benny. No — don't tell Benny. Tell him I'm doing great.": "[laughs, breathless] Ha! Tell Benny. [panicked] No — don't tell Benny. [sheepish] Tell him I'm doing great.",
	"Uncle Benny thinks I'm a kid. So we do a grown-up job: there's a buyer for a patrol car, lights and all. Take one from the station lot.": "[sulky] Uncle Benny thinks I'm a kid. [excited] So we do a grown-up job — there's a buyer for a patrol car, lights and all. Take one from the station lot.",
	"The whole force will be on you — shake them, then get it to the chop shop before my buyer walks.": "[nervous] The whole force will be on you... shake them, then get it to the chop shop before my buyer walks.",
	"Purple's a popular colour, man. Half this city—": "[defensive, fast] Purple's a popular colour, man. Half this city—",
	"...okay. Okay! They said nobody'd get hurt. It was one phone call.": "[long exhale] ...okay. [cracking] Okay! They said nobody'd get hurt. [pleading] It was one phone call.",
	"You've got the books? ...Yeah. Two grand. I'm not proud of it.": "[stunned] You've got the books? [pause] [ashamed] ...Yeah. Two grand. I'm not proud of it.",
	"Crane's people said it was an insurance thing. I needed the money. I'm sorry.": "[miserable] Crane's people said it was an insurance thing. I needed the money. [close to tears] I'm sorry.",
	"You just cost me everything. Remember that.": "[bitter, shaking] You just cost me everything. [cold] Remember that.",
	"I owe you. I mean it — whatever you need, whenever.": "[grateful, quietly] I owe you. [sincere] I mean it — whatever you need, whenever.",
	"Door's propped. Three on the corner, they're bored. Good luck, I'm leaving.": "[whispers, nervous] Door's propped. Three on the corner, they're bored. [hurried] Good luck, I'm leaving.",
	"Crane pays better than family, turns out!": "[shouting, bitter] Crane pays better than family, turns out!",
	"Side door, like I promised. We're square now, right? Right?": "[hopeful] Side door, like I promised. We're square now, right? [nervous laugh] Right?",
	"Meridian plates on a red sedan, west side. Chop shop's buying.": "[eager] Meridian plates on a red sedan, west side. Chop shop's buying.",

	// Marisol
	"More coming round the loop — from the north side!": "[shouting] More coming round the loop — from the north side!",
	"The Cinder Boys work for Meridian. Everyone knows. Now everyone knows you know.": "[catching breath] The Cinder Boys work for Meridian. Everyone knows. [grim satisfaction] Now everyone knows you know.",
	"The Cinder Boys have been leaning on families in Sunset Park — Meridian wants the land for warehouses and they're doing the asking.": "[angry, controlled] The Cinder Boys have been leaning on families in Sunset Park. Meridian wants the land for warehouses... and they're doing the asking.",
	"Five on the street, three carrying, and they'll call for back-up the moment it starts. End it.": "Five on the street, three carrying, and they'll call for back-up the moment it starts. [resolute] End it.",
	"Psst. Over here. Mind the one by the rail — he hums when he's bored.": "[whispers] Psst. Over here. Mind the one by the rail — [amused whisper] he hums when he's bored.",
	"Took you long enough. Let's go.": "[relieved, hiding it] Took you long enough. [quietly] Let's go.",
	"Well, that's subtle.": "[sarcastic] Well. That's subtle.",
	"They wanted to know who's organising the tenants. I told them: everybody.": "[tired, proud] They wanted to know who's organising the tenants. [small laugh] I told them: everybody.",
	"The tenants' committee had a long talk with Mr. Crane. He's signing the land over.": "[satisfied] The tenants' committee had a long talk with Mr. Crane. [warmly] He's signing the land over.",
	"They're back on the corner by the chop shop. Please.": "[weary] They're back on the corner by the chop shop. [pause] [softly] Please.",

	// Static
	"Two a.m.: a call from Kasper Motors' own line to a Meridian dispatch number. Thirty seconds.": "[curious] Two a.m. A call from Kasper Motors' own line... to a Meridian dispatch number. Thirty seconds.",
	"Somebody inside. A night attendant at Sunrise Hospital saw a Meridian van that night.": "[thoughtful] Somebody inside. [quicker] A night attendant at Sunrise Hospital saw a Meridian van that night.",
	"Purple jacket. Oh no. Oh, Benny's not going to like this.": "[slowly] Purple jacket. [surprised] Oh no. [groans] Oh, Benny's not going to like this.",
	"Two grand from Meridian Logistics, filed as 'consulting'. Consulting. Ha.": "Two grand from Meridian Logistics, filed as 'consulting'. [scoffs] Consulting. [bitter laugh] Ha.",
	"Benny wants to know who told Meridian his client's car was on the lot. I've got the dispatch logs. You've got legs. Between us we've got a detective.": "Benny wants to know who told Meridian his client's car was on the lot. I've got the dispatch logs. You've got legs. [pleased] Between us, we've got a detective.",
	"Kind of.": "[pause] [sheepish] Kind of.",
	"Tip from me: they can't see behind them. A quiet word from behind does wonders.": "[whispers] Tip from me — they can't see behind them. [mischievous] A quiet word from behind does wonders.",
	"Take my sedan. Beige. Nobody has ever noticed a beige sedan. That's the genius.": "Take my sedan. Beige. [proudly] Nobody has ever noticed a beige sedan. [smug] That's the genius.",
	"Black Vesper pulling out. That's him. Hang back.": "[tense, low] Black Vesper pulling out. That's him. [whispers] Hang back.",
	"Jax is moving! He's going for the Sea Link!": "[alarmed] Jax is moving! He's going for the Sea Link!",
	"Close enough to read a plate, far enough not to be shot. You know. Easy.": "Close enough to read a plate, far enough not to be shot. [nervous laugh] You know. Easy.",
	"He signals every turn. Nobody signals every turn. Paranoid.": "[muttering] He signals every turn. Nobody signals every turn. [impressed] Paranoid.",
	"He took a call — he's turning east. The meet's moved to Marina Heights.": "[urgent] He took a call — he's turning east! The meet's moved to Marina Heights.",
	"They've seen you! It's happening now!": "[panicked shout] They've seen you! It's happening now!",
	"Jax Ruelle — Crane's driver, the guy who called you — is moving Meridian money to a buyer today. Follow him to the meet. Not close.": "Jax Ruelle — Crane's driver, the guy who called you — is moving Meridian money to a buyer today. Follow him to the meet. [emphatic] Not close.",
	"He's paranoid, and he's good.": "[serious] He's paranoid. And he's good.",
	"Four of Crane's at the top. Drive in and they'll hear the engine. Walk the last bit.": "[low, focused] Four of Crane's at the top. Drive in and they'll hear the engine. Walk the last bit.",
	"He's not in there — garage door's open! White Vesper, heading for the Sea Link!": "[frantic] He's not in there — garage door's open! White Vesper, heading for the Sea Link!",
	"Somebody called it in. Cops inbound — lots of them.": "[worried] Somebody called it in. Cops inbound — [gulps] lots of them.",
	"Courier van, westbound, any second now. Don't shoot the bag.": "Courier van, westbound, any second now. [dry] Don't shoot the bag.",

	// The attendant and the guards
	"Kid in a purple jacket sat in that van ten minutes. Moustache like a dare. Hard to forget.": "[amused] Kid in a purple jacket sat in that van ten minutes. [chuckles] Moustache like a dare. Hard to forget.",
	"Somebody's on the yard! Lock the gate!": "[shouting, alarmed] Somebody's on the yard! Lock the gate!",
	"Visitors! Watch the woman!": "[shouting] Visitors! Watch the woman!",
	"Side door! Somebody's at the side door!": "[yelling] Side door! Somebody's at the side door!",

	// Kincaid
	"Five on the yard. Crane pays for loyalty, not eyesight. Come at them from behind.": "Five on the yard. [dry] Crane pays for loyalty, not eyesight. Come at them from behind.",
	"Park on the bridge and walk. An engine at that gate gets noticed.": "[low] Park on the bridge and walk. An engine at that gate gets noticed.",
	"Got it? Then get off that bridge.": "[tense] Got it? Then get off that bridge.",
	"This is enough to start. Not to finish. Stay reachable.": "[measured] This is enough to start. [pause] Not to finish. Stay reachable.",
	"That alarm rings at Meridian, not at us. Their muscle's coming down the bridge.": "[urgent] That alarm rings at Meridian, not at us. Their muscle's coming down the bridge.",
	"You've been busy on Meridian's dime. Crane keeps a paper ledger at his Sea Link depot — the man doesn't trust computers.": "[wry] You've been busy on Meridian's dime. Crane keeps a paper ledger at his Sea Link depot — [scoffs] the man doesn't trust computers.",
	"Bring it to me and I can open a case. Get seen, and his people will shoot first.": "Bring it to me and I can open a case. [serious] Get seen... and his people will shoot first.",
	"Plates came through. Two Meridian accountants and a man with no fingerprints. Thanks.": "Plates came through. Two Meridian accountants and... a man with no fingerprints. [grudging] Thanks.",
	"Ruelle? In cuffs? I'm buying you a coffee. A small one.": "[surprised] Ruelle? In cuffs? [laughs] I'm buying you a coffee. [dry] A small one.",
	"Your ledger paid off: we've boxed in one van at the ramp. Three left. Your problem.": "Your ledger paid off — we've boxed in one van at the ramp. Three left. [dry] Your problem.",
	"Somebody reported shots at the lookout. Lose my people before you get her home, or she spends the night in an interview room.": "[annoyed] Somebody reported shots at the lookout. Lose my people before you get her home, or she spends the night in an interview room.",
	"My units are holding the bridge approach. Nobody's coming for you. Today.": "My units are holding the bridge approach. Nobody's coming for you. [pause] [pointed] Today.",
	"Silas Crane, booked at 9:14. The ledger made it stick. Thank you — off the record.": "[quiet satisfaction] Silas Crane, booked at nine fourteen. The ledger made it stick. [sincere, softer] Thank you. Off the record.",

	// Quill
	"Crane's handwriting! I'll have it framed. And then I'll have it used.": "[delighted] Crane's handwriting! I'll have it framed. [wicked] And then I'll have it used.",
	"Magnificent. Keep her. Send Crane a photo.": "[breathless, delighted] Magnificent. Keep her. [gleeful] Send Crane a photo.",
	"Crane outbid me on a car once. I've hated him professionally ever since — and anyone who annoys him is a friend.": "[theatrical] Crane outbid me on a car once. I've hated him professionally ever since — [warmly] and anyone who annoys him is a friend.",
	"My Vesper, the sea link, the far end in thirty seconds. Beat the clock and she's yours.": "My Vesper. The sea link. The far end in thirty seconds. [teasing] Beat the clock and she's yours.",

	// Jax and Crane
	"You put a dent in Mr. Crane's afternoon. He noticed. — Jax.": "[cold, amused] You put a dent in Mr. Crane's afternoon. [pause] He noticed.",
	"Fine. You can drive. Now what?": "[sullen] Fine. You can drive. [defiant] Now what?",
	"I'll remember this. Not fondly. But I'll remember.": "[grudging] I'll remember this. [dry] Not fondly. [quietly] But I'll remember.",
	"Should've stayed home, beige.": "[taunting] Should've stayed home, beige.",
	"Buckle up, Mr. Crane. This one's personal.": "[menacing] Buckle up, Mr. Crane. This one's personal.",
	"Took the day off. You're welcome.": "[smug] Took the day off. [laughs] You're welcome.",
	"Heard Crane drove himself. Badly. Told you I'd remember.": "[amused] Heard Crane drove himself. [snorts] Badly. [warmer] Told you I'd remember.",
	"Let's be adults. Everyone has a number. What's yours?": "[calm, smooth] Let's be adults. Everyone has a number. [softly] What's yours?",
	"A pleasure doing business. You'll never see me again.": "[smug] A pleasure doing business. [softly] You'll never see me again.",
	"Where is Ruelle? Where is my driver?": "[losing composure] Where is Ruelle? [shouting] Where is my driver?",
	"I'll drive myself, then. How hard can it be?": "[contemptuous] I'll drive myself, then. [scoffs] How hard can it be?",

	// The air base
	"Low over the water first. Don't touch it — it's harder than it looks.": "Low over the water first. [warning] Don't touch it — it's harder than it looks.",
	"Fine. You can fly. I'll tell the Major. Don't let it go to your head.": "[grudging] Fine. You can fly. I'll tell the Major. [gruff] Don't let it go to your head.",
	"Major Vos says you're the civilian who's been embarrassing Meridian Logistics. She wants you in the air. I want proof you won't crash my jet.": "[sceptical] Major Vos says you're the civilian who's been embarrassing Meridian Logistics. She wants you in the air. [gruff] I want proof you won't crash my jet.",
	"Eight rings, two of them down on the waves, two and a half minutes.": "Eight rings. Two of them down on the waves. Two and a half minutes.",
	"Four vans. Your detective friend didn't lift a finger. I wonder why.": "Four vans. Your detective friend didn't lift a finger. [suspicious] I wonder why.",
	"Every crate accounted for. Whatever Crane is planning, he's planning it without my rockets.": "[satisfied] Every crate accounted for. [cold] Whatever Crane is planning, he's planning it without my rockets.",
	"Ordnance stolen from my depot is moving under Meridian Logistics manifests. The vans left the city a minute ago for the expressway.": "[controlled anger] Ordnance stolen from my depot is moving under Meridian Logistics manifests. The vans left the city a minute ago for the expressway.",
	"The gunship's on the pad. None of them reaches the hills.": "The gunship's on the pad. [cold, final] None of them reaches the hills.",

	// Code Three
	"Medic One, T-bone on the west avenue, one vehicle fully involved, one occupant out. Fire's been called.": "[radio, brisk] Medic One, T-bone on the west avenue. One vehicle fully involved, one occupant out. Fire's been called.",
	"On foot. Talk to her, check her airway, and don't stand downwind of that thing.": "[focused] On foot. Talk to her, check her airway — [sharp] and don't stand downwind of that thing.",
	"It's leaking fuel. You've got seconds. Move her, now!": "[alarmed] It's leaking fuel. You've got seconds. [shouting] Move her, now!",
	"Good call. Collar on, keep her talking. The engine's on its way.": "[relieved] Good call. [calm] Collar on, keep her talking. The engine's on its way.",
	"Smooth and quick. Every pothole, she feels it — and so does the rig.": "[steady] Smooth and quick. Every pothole, she feels it — [wry] and so does the rig.",
	"Medic One, caller says the second car's caught. Where are you?": "[radio, urgent] Medic One, caller says the second car's caught. Where are you?",
	"Engine company reports the fire's knocked down. Load and go, Medic One.": "[radio] Engine company reports the fire's knocked down. Load and go, Medic One.",
	"Medic One, units are clearing your route. Nobody's chasing an ambulance today.": "[radio, faint humour] Medic One, units are clearing your route. Nobody's chasing an ambulance today.",
	"Pulled her clear with seconds to spare. Reckless — but she's alive. Come drive for us again.": "[exhales] Pulled her clear with seconds to spare. Reckless — [softening] but she's alive. [warmly] Come drive for us again.",
	"Textbook. The crew says you kept her still the whole time. Come drive for us again.": "[impressed] Textbook. The crew says you kept her still the whole time. [warmly] Come drive for us again.",
	"We're a driver short and there's a T-bone on the west avenue, one car on fire. Take a rig from the bay — lights and siren, Code Three.": "[urgent] We're a driver short and there's a T-bone on the west avenue, one car on fire. Take a rig from the bay — lights and siren. Code Three.",
	"Get her out, get her back here, and don't shake her to pieces on the way.": "Get her out, get her back here... [stern] and don't shake her to pieces on the way.",

	// Lena
	"You're Benny's new driver? I'm Lena. I open things that don't want opening.": "[curious] You're Benny's new driver? [amused] I'm Lena. I open things that don't want opening.",
	"Van's clean. We go in, we come out, we never come back.": "[calm] Van's clean. We go in, we come out... we never come back.",
	"Four on the door. Meridian pays them to stand there looking bored.": "[low] Four on the door. [dry] Meridian pays them to stand there looking bored.",
	"Clear the door. I'll be right behind you.": "[quietly] Clear the door. I'll be right behind you.",
	"Door's ours. Now the cage.": "[satisfied] Door's ours. [focused] Now the cage.",
	"Three locks and a timer. Thirty seconds — and don't let anyone shoot me.": "[concentrating] Three locks and a timer. Thirty seconds — [tense] and don't let anyone shoot me.",
	"Open! Bags, bags, bags — okay, go!": "[thrilled] Open! [hurried] Bags, bags, bags — okay, go!",
	"Silent alarm on the cage. Every cop in the city just heard about us.": "[sighs] Silent alarm on the cage. [grim] Every cop in the city just heard about us.",
	"All units, armed robbery on the commercial strip. Beige panel van, westbound. Roadblocks are going up.": "[radio] All units, armed robbery on the commercial strip. Beige panel van, westbound. Roadblocks are going up.",
	"Clean car, clean plates. Leave the van, it's done its job.": "[breathless] Clean car, clean plates. Leave the van — it's done its job.",
	"Side streets. Tight corners. They hate tight corners.": "Side streets. Tight corners. [smug] They hate tight corners.",
	"Benny says you caught a Vesper with a family sedan. True, or is Benny being Benny?": "[curious] Benny says you caught a Vesper with a family sedan. [teasing] True, or is Benny being Benny?",
	"Loans out the front, cash cage out the back. Meridian launders through other people's debts. Charming.": "Loans out the front, cash cage out the back. Meridian launders through other people's debts. [disgusted] Charming.",
	"Radio down when we get close. I like to hear a door before I see it.": "[softly] Radio down when we get close. I like to hear a door before I see it.",
	"Cinder Boys, west end! Meridian called in the help!": "[shouting] Cinder Boys, west end! Meridian called in the help!",
	"One more, east side! Keep them off me!": "[panicked] One more, east side! Keep them off me!",
	"Police cars across the avenue up ahead — go round, or go through the gap at the kerb!": "[urgent] Police cars across the avenue up ahead — go round, or go through the gap at the kerb!",
	"You drive like someone who's never been told no. I like it. Benny will hate it.": "[laughs, breathless] You drive like someone who's never been told no. I like it. [giggles] Benny will hate it.",
	"Crane's going to count his till tonight and come up short. I want to see his face. I won't. But I want to.": "[gleeful] Crane's going to count his till tonight and come up short. I want to see his face. [wistful] I won't. [warmly] But I want to.",
	"If you ever need a door opened, kid, you know where Benny keeps me.": "[warm, sly] If you ever need a door opened, kid... you know where Benny keeps me.",

	// Rosa
	"From the back of the grid! Okay, okay. You're in.": "[impressed laugh] From the back of the grid! Okay, okay. [playful] You're in.",
	"Two laps round the blocks, lights or no lights. My three best are already on the grid. Jax Ruelle used to race here before Crane bought him.": "[confident] Two laps round the blocks, lights or no lights. My three best are already on the grid. [bitter] Jax Ruelle used to race here... before Crane bought him.",
	"You start at the back — win it.": "[challenging] You start at the back. Win it.",
	"You didn't blink. I'm not sure you have eyelids.": "[laughs] You didn't blink. [teasing] I'm not sure you have eyelids.",
	"Straight line, top speed, whoever blinks loses. The far end of the bridge, first one there.": "[playful] Straight line, top speed, whoever blinks loses. The far end of the bridge. First one there.",
	"Gold suits you. Don't let it go to your head — let it go to your garage.": "[warm, teasing] Gold suits you. Don't let it go to your head — [laughs] let it go to your garage.",
	"Up the Ghats, through the tunnel, to the top. They know every bend. Beat them and the gold Vesper is yours.": "Up the Ghats, through the tunnel, to the top. They know every bend. [tempting] Beat them, and the gold Vesper is yours.",
	"Round the blocks, back here, fifty-five seconds. Go when you're rolling.": "Round the blocks, back here, fifty-five seconds. [playful] Go when you're rolling.",
};
