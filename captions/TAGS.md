# Piece tags

Every described piece gets tags from these lists only, so the index can be searched on them. Tags are lower case with hyphens. A piece takes as many as clearly apply, usually 4–10. When nothing fits, say so in the description rather than inventing a tag; a tag that keeps being missed gets added here.

## Style (the look it belongs to)
superhero · sci-fi · cyberpunk · robotic · military · tactical · police · medieval · fantasy · gothic · occult · mystic · steampunk · western · pulp · noir · street · punk · casual · formal · sporty · tribal · ancient · egyptian · greco-roman · east-asian · pirate · holiday · alien · organic · monstrous · animal · insect · aquatic · elemental · cute · luxury

## Material look (what it appears to be made of, as modelled; the material chosen can change it)
cloth · leather · metal · plate-armor · chainmail · latex · fur · feathers · scales · bone · crystal · stone · wood · energy · glass · plastic · skin · hair

## Form
form-fitting · loose · flowing · bulky · sleek · spiky · ornate · plain · layered · tattered · segmented · rounded · angular · asymmetric

## Features
hood · collar · high-collar · lapels · cape · scarf · belt · pouches · straps · buckles · zipper · buttons · laces · chains · spikes · studs · rivets · gems · emblem · trim · fringe · ribbons · bow · feathered · horns · wings · tail · fins · claws · lights · vents · cables · tubes · visor · goggles · mask · armor-plates · holster · sheath · pockets · wraps · jewellery · skull

## Coverage and length
full-coverage · partial · revealing · sleeveless · short-sleeved · long-sleeved · open-front · cropped · waist-length · hip-length · knee-length · ankle-length · floor-length

## Entry format (captions/captions.json)

```json
"Male/M_Cape_Tight_Feather_01": {
  "mesh": "bin/geobin/cl/A/M/M_Cape_Tight_Feather_01.mset",
  "model": "Geo_Cape_Tight_Feather_01",
  "description": "One or two sentences, 15–40 words: silhouette, construction details, how it sits on the body, the style it suggests.",
  "colourAreas": "Which parts take which colour slot, as seen on the sheet (0 light grey, 1 blue, 2 near black, 3 red).",
  "tags": ["fantasy", "feathers", "tattered", "cape", "feathered", "knee-length"],
  "differs": "Only when the male and female versions differ noticeably: how.",
  "from": "sheet", "date": "2026-09-29"
}
```

The sheets show each piece in its default material with a fixed four-colour scheme (0 light grey, 1 mid blue, 2 near black, 3 red) on a grey mannequin, so `colourAreas` can name which features take which slot.
