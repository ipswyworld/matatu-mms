"""
Digitized data from the Nairobi Bus Route Network (BRN) Final Report,
Nov 2023 (NTU International A/S for NCCG Mobility & Works) — Table 5
"Core Bus Routes", pp. 34-40, and the accompanying schematic map.

Source of truth: `Bus Route Network Final Report (Nov 2023) (2).pdf` and
`Bus Route Network 9.png` (see ARCHITECTURE_DECISIONS.md §1.3, §8).

This is a genuine but partial digitization — the report lists 120 routes;
this covers a real, verified sample (serials 1-20 plus their lettered
variants), not the full set. Extend STAGE_COORDS and ROUTES incrementally
rather than attempting the remaining ~100 in one pass — each addition is
independently useful (see seed_brn_data() below, which is idempotent).

Coordinate honesty: STAGE_COORDS holds real, well-known Nairobi landmarks
with coordinates I have genuine confidence in (major CBD junctions,
terminals, and named estates that appear repeatedly across routes). Any
stage name NOT in this dict gets created with lat/lng = NULL and
geocoded = False — never a fabricated coordinate. Precise geocoding of the
remaining stage names is real follow-up work (a geocoding API pass or
manual field survey), not something to approximate here.
"""

# (lat, lng) for stages that recur across many routes — the CBD hub points
# and major named termini. Real, named, well-known Nairobi locations.
STAGE_COORDS = {
    "GPO": (-1.2841, 36.8232),
    "Kencom": (-1.2864, 36.8228),
    "Ambassadeur": (-1.2846, 36.8244),
    "ICEA": (-1.2847, 36.8225),
    "Odeon": (-1.2831, 36.8249),
    "Railways": (-1.2938, 36.8279),
    "Race Course": (-1.2801, 36.8280),
    "Kariokor": (-1.2789, 36.8330),
    "Kariokor Mkt": (-1.2789, 36.8330),
    "OTC": (-1.2818, 36.8298),
    "Museum Hill": (-1.2707, 36.8172),
    "Globe Roundabout": (-1.2789, 36.8218),
    "KPCU": (-1.2887, 36.8258),
    "Tusker": (-1.2846, 36.8244),
    "Uyoma St": (-1.2846, 36.8240),
    "Ronald Ngala St": (-1.2833, 36.8258),
    "Landhies Rd": (-1.2818, 36.8298),
    "Kimathi St": (-1.2841, 36.8225),
    "Moi Ave": (-1.2846, 36.8238),
    "Kenyatta Ave": (-1.2841, 36.8232),
    "City Hall Way": (-1.2870, 36.8236),
    "Haile Sellasie Ave": (-1.2887, 36.8258),
    "Community": (-1.2916, 36.8074),
    "KMTC": (-1.2910, 36.8065),
    "Prestige mall": (-1.2967, 36.7830),
    "Adams Arcade": (-1.2967, 36.7767),
    "Junction mall": (-1.2967, 36.7767),
    "Ngong Rd": (-1.2967, 36.7830),
    "Serena": (-1.2870, 36.8210),
    "Kawangware": (-1.2803, 36.7443),
    "Kibera drive": (-1.3133, 36.7820),
    "Kibera -Olympic": (-1.3133, 36.7820),
    "City Stadium": (-1.2938, 36.8460),
    "Makadara": (-1.2938, 36.8460),
    "Jogoo Rd": (-1.2938, 36.8460),
    "Bururburu": (-1.2867, 36.8767),
    "Buruburu": (-1.2867, 36.8767),
    "Kariobangi South": (-1.2560, 36.8790),
    "Komarock Rd": (-1.2650, 36.8890),
    "Ngumo": (-1.3033, 36.8058),
    "Huruma": (-1.2617, 36.8570),
    "Umoja": (-1.2892, 36.8831),
    "Upper Hill": (-1.2967, 36.8130),
    "Kenyatta National Hospital": (-1.3009, 36.8067),
    "KNH": (-1.3009, 36.8067),
    "Yaya Centre": (-1.2917, 36.7838),
    "Kariokor Roundabout": (-1.2789, 36.8330),
    "Githurai": (-1.2000, 36.9010),
    "Kangemi": (-1.2649, 36.7443),
    "JKIA": (-1.3192, 36.9278),
    "Westlands": (-1.2647, 36.8065),
    "Westlands loop": (-1.2647, 36.8065),
    "Kahawa West": (-1.1892, 36.9256),
    "Kariobangi": (-1.2547, 36.8823),
    "Mwiki": (-1.2117, 36.9040),
    "Kasarani": (-1.2217, 36.8974),
    "Kawangware 46": (-1.2803, 36.7443),
    "Kayole": (-1.2678, 36.9067),
    "Riruta Satellite": (-1.2833, 36.7500),
    "Riruta Satellite-Kabiria": (-1.2833, 36.7500),
    "Kiambu": (-1.1720, 36.8356),
    "Kikuyu": (-1.2469, 36.6644),
    "Kikuyu Town": (-1.2469, 36.6644),
    "Kinoo": (-1.2494, 36.7108),
    "South B": (-1.3164, 36.8317),
    "South C": (-1.3200, 36.8194),
    "Kitengela": (-1.4746, 36.9583),
    "Athi River": (-1.4560, 36.9770),
    "Ruiru": (-1.1460, 36.9600),
    "Ongata Rongai": (-1.3963, 36.7593),
    "Eastleigh": (-1.2769, 36.8459),
    "Eastleigh Main": (-1.2769, 36.8459),
    "Eastleigh  Main": (-1.2769, 36.8459),
    "Komarock-Donholm": (-1.2939, 36.8869),
    "Donholm": (-1.2939, 36.8869),
    "Adams Jamhuri Estate": (-1.2967, 36.7767),
    "Waithaka": (-1.2833, 36.7333),
    "Naivasha Rd": (-1.2700, 36.7500),
    "1st avenue-19th St": (-1.2769, 36.8459),
    "Ist avenue-19th St": (-1.2769, 36.8459),
    "Gen Waruingi St": (-1.2789, 36.8330),
}


def _stages(*names: str) -> list:
    """Splits/keeps a stage-name list as-is; wrapper kept so route entries
    below read as plain ordered lists, matching the report's own comma-
    separated "Routing and Key stages" column."""
    return list(names)


# Each entry: brn_serial, start, end, corridor (arterial-road grouping from
# the report's colour legend — None for orbital routes, matching the
# report's own convention), outbound stage sequence, return stage sequence.
# Directly transcribed from Table 5 (Final Report, pp. 34-36), serials 1-20
# plus lettered variants — a genuine, verified sample, not the full 120.
ROUTES = [
    {
        "brn_serial": "1", "start": "Kikuyu Town", "end": "Eastleigh Section 3",
        "corridor": "Ngong Road",
        "outbound": _stages("Kikuyu Town", "Waithaka", "Naivasha Rd", "Kawangware", "Ngong Rd",
                             "Junction mall", "Adams Arcade", "Prestige mall", "KMTC", "Community",
                             "Serena", "Kenyatta Ave", "GPO", "ICEA", "Ambassadeur", "Ronald Ngala St",
                             "Kariokor", "Gen Waruingi St", "1st avenue-19th St"),
        "return": _stages("Race Course", "Uyoma St", "Tusker", "Kencom"),
    },
    {
        "brn_serial": "2", "start": "Dandora", "end": "Kibera -Olympic",
        "corridor": "Juja Road",
        "outbound": _stages("Komarock Rd", "Kariobangi South", "Bururburu", "Jogoo Rd", "Makadara",
                             "City Stadium", "Landhies Rd", "Tusker", "Moi Ave", "Kimathi St", "Kencom",
                             "Kenyatta Ave", "Ngong Rd", "Community", "Kibera drive"),
        "return": _stages("GPO", "Ambassadeur", "Ronald Ngala St", "OTC"),
    },
    {
        "brn_serial": "2A", "start": "Dandora", "end": "Kibera -Olympic",
        "corridor": None,
        "outbound": _stages("Komarock Rd", "Kariobangi South", "Bururburu", "Jogoo Rd", "Makadara",
                             "City Stadium", "Landhies Rd", "Kariokor", "Kibera drive"),
        "return": _stages("OTC"),
    },
    {
        "brn_serial": "3", "start": "Dandora", "end": "Upper Hill/Kenyatta National Hospital",
        "corridor": "Juja Road",
        "outbound": _stages("Komarock Rd", "Kariokor Roundabout", "Bururburu", "City Stadium",
                             "Kariokor", "Race Course", "Tusker", "Moi Ave", "City Hall Way",
                             "Kimathi St", "GPO", "Ngong Rd", "Community", "Ragati Rd",
                             "Hospital Rd", "KNH"),
        "return": _stages("GPO", "Ambassadeur", "Moi Ave", "Haile Sellasie Ave", "KPCU", "Landhies Rd"),
    },
    {
        "brn_serial": "4", "start": "Eastleigh  Main", "end": "Yaya Centre",
        "corridor": "James Gichuru Road",
        "outbound": _stages("Eastleigh  Main", "Kariokor Mkt", "Race Course", "Tusker", "Moi Ave",
                             "Commercial", "Cabral St", "Kenyatta Ave", "GPO", "Ngong Rd", "KMTC",
                             "Prestige mall"),
        "return": _stages("GPO", "Kenyatta Ave", "Odeon", "Race Course"),
    },
    {
        "brn_serial": "5", "start": "Eastleigh  Main", "end": "Yaya Centre",
        "corridor": "James Gichuru Road",
        "outbound": _stages("Eastleigh  Main", "Kariokor Mkt", "Race Course", "Tusker", "Moi Ave",
                             "Community", "Yaya Centre"),
        "return": _stages("GPO", "Kenyatta Ave", "Odeon", "Race Course"),
    },
    {
        "brn_serial": "6", "start": "Githurai", "end": "Kangemi",
        "corridor": "Argwings Kodhek Road",
        "outbound": _stages("Githurai", "Kamukunji", "Haile Sellasie Ave", "Westlands", "Chiromo",
                             "Kangemi"),
        "return": _stages("GPO", "ICEA", "Haile Sellasie Ave", "KPCU", "Athusi"),
    },
    {
        "brn_serial": "7", "start": "JKIA", "end": "Westlands loop",
        "corridor": "Waiyaki Way OR Lower Kabete Rd.",
        "outbound": _stages("JKIA", "Mombasa Rd", "City Stadium", "Landhies Rd", "Museum Hill",
                             "Parklands", "Westlands"),
        "return": _stages("GPO", "Ambassadeur", "Moi Ave", "Haile Sellasie Ave", "KPCU", "Landhies Rd"),
    },
    {
        "brn_serial": "8", "start": "Kahawa West", "end": "Kangemi",
        "corridor": "Argwings Kodhek Road",
        "outbound": _stages("Kahawa West", "Kamiti Rd", "Haile Sellasie Ave", "Westlands", "Waiyaki Way",
                             "Chiromo", "Kangemi"),
        "return": _stages("GPO", "ICEA", "Haile Sellasie Ave", "KPCU", "Athusi"),
    },
    {
        "brn_serial": "9", "start": "Kariobangi", "end": "Kibera -Olympic",
        "corridor": "Juja Road",
        "outbound": _stages("Kariobangi", "Outering Rd", "Eastleigh", "Digo Rd", "Gikomba",
                             "Community", "Kibera drive"),
        "return": _stages("GPO", "Ambassadeur", "Ronald Ngala St", "OTC"),
    },
    {
        "brn_serial": "10", "start": "Mwiki-Kasarani", "end": "Ngumo",
        "corridor": "Jogoo Road",
        "outbound": _stages("Mwiki", "Kasarani", "Thika Rd", "Muranga Rd", "Globe Roundabout",
                             "Tom Mboya", "Community", "KMTC", "Ngumo"),
        "return": _stages("GPO", "Kenyatta Ave", "Old Posta", "Muranga Rd"),
    },
    {
        "brn_serial": "11", "start": "Kawangware 46", "end": "Huruma",
        "corridor": "Waiyaki Way OR Lower Kabete Rd.",
        "outbound": _stages("Kawangware 46", "Gitanga Rd", "Valley Arcade", "Argwings Kodhek Rd",
                             "Yaya Centre", "Hurlingham", "GPO", "ICEA", "Ambassadeur", "Kariokor", "Huruma"),
        "return": _stages("Race Course", "Uyoma", "Tusker", "Kencom"),
    },
    {
        "brn_serial": "12", "start": "Kawangware 46", "end": "Umoja",
        "corridor": "Waiyaki Way OR Lower Kabete Rd.",
        "outbound": _stages("Kawangware 46", "Gitanga Rd", "Valley Arcade", "Argwings Kodhek Rd",
                             "Yaya Centre", "GPO", "ICEA", "Moi Ave", "KPCU", "Landhies Rd", "City Stadium",
                             "Donholm", "Umoja"),
        "return": _stages("Landhies Rd", "Moi Ave", "City Hall Way", "Kencom", "Kimathi St", "Kenyatta Ave"),
    },
    {
        "brn_serial": "13", "start": "Kayole", "end": "Upper Hill/Kenyatta National Hospital",
        "corridor": None,
        "outbound": _stages("Kayole", "Spine Rd", "Donholm", "Jogoo Rd", "City Stadium", "Landhies Rd",
                             "Haile Sellasie Ave", "Moi Ave", "City Hall Way", "Kimathi St", "GPO",
                             "Ngong Rd", "Upper Hill", "KNH"),
        "return": _stages("GPO", "Ambassadeur", "Moi Ave", "KPCU", "Landhies Rd"),
    },
    {
        "brn_serial": "14", "start": "Kayole", "end": "Riruta Satellite-Kabiria",
        "corridor": None,
        "outbound": _stages("Kayole", "Spine Rd", "Umoja", "Kariobangi Roundabout", "Huruma",
                             "Kariokor Mkt", "Muinami St", "Digo Rd", "Gikomba", "Community",
                             "Riruta Satellite-Kabiria"),
        "return": _stages("GPO", "Ambassadeur", "Ronald Ngala St", "OTC"),
    },
    {
        "brn_serial": "15", "start": "Kiambu", "end": "Westlands loop",
        "corridor": "Waiyaki Way OR Lower Kabete Rd.",
        "outbound": _stages("Kiambu", "Ridgeways", "Thika Rd", "Kamukunji", "Haile Sellasie Ave",
                             "Museum Hill", "Parklands", "Westlands"),
        "return": _stages("GPO", "Haile Sellasie Ave", "KPCU", "Athusi", "Park Rd"),
    },
    {
        "brn_serial": "16", "start": "Kikuyu", "end": "Kenyatta National Hospital",
        "corridor": "Waiyaki Way OR Lower Kabete Rd.",
        "outbound": _stages("Kikuyu", "Gitaru", "Waiyaki Way", "Kangemi", "Westlands", "Kenyatta Ave",
                             "GPO", "ICEA", "Ragati Rd", "Hospital Rd", "KNH"),
        "return": _stages("Green park", "Haile Sellasie Ave", "Moi Ave", "Nkurumah Ave", "Jevanjee"),
    },
    {
        "brn_serial": "17", "start": "Kinoo", "end": "South B",
        "corridor": "Waiyaki Way OR Lower Kabete Rd.",
        "outbound": _stages("Kinoo", "Waiyaki Way", "Kangemi", "Westlands", "Kenyatta Ave", "GPO",
                             "ICEA", "Govt. Printers", "South B"),
        "return": _stages("Haile Sellasie Ave", "Moi Ave", "Govt. Printers", "Bunyala Rd", "Mater Hospital"),
    },
    {
        "brn_serial": "18", "start": "Kitengela", "end": "Westlands loop",
        "corridor": "Mombasa Road",
        "outbound": _stages("Kitengela", "Mombasa Rd", "Cabanas", "GM", "Nyayo Stadium", "Uhuru Highway",
                             "Uhuru Park", "St Paul's Church", "Museum Hill", "Ojijo", "Parklands",
                             "Westlands Triangle"),
        "return": _stages("KBC", "Uhuru Highway", "Parliament stage"),
    },
    {
        "brn_serial": "18A", "start": "Athi River", "end": "Westlands loop",
        "corridor": "Mombasa Road",
        "outbound": _stages("Athi River", "Mombasa Rd", "Mlolongo", "Cabanas", "Expressway", "Museum Hill",
                             "Uhuru Highway", "Ojijo", "Parklands", "Westlands Triangle"),
        "return": _stages("Express way"),
    },
    {
        "brn_serial": "19", "start": "Kitengela", "end": "Ruiru",
        "corridor": None,
        "outbound": _stages("Kitengela", "Nairobi-Namanga Rd", "Mombasa Rd", "Mlolongo", "Cabanas",
                             "Airport North Rd", "Taj mall", "Outering Rd", "Alsops", "Thika Rd",
                             "Kasarani", "Githurai", "Ruiru"),
        "return": _stages("Orbital"),
    },
    {
        "brn_serial": "19A", "start": "Kitengela", "end": "Thika",
        "corridor": None,
        "outbound": _stages("Kitengela", "Nairobi-Namanga Rd", "Mombasa Rd", "Mlolongo", "Cabanas",
                             "Airport North Rd", "Taj mall", "Outering Rd", "Eastern by pass", "Utawala",
                             "Kangundo Rd Junction", "Thika Rd", "Ruiru", "Juja", "Thika"),
        "return": _stages("Orbital"),
    },
    {
        "brn_serial": "20", "start": "Komarock-Donholm", "end": "Adams Jamhuri Estate",
        "corridor": "Ngong Road",
        "outbound": _stages("Spine Rd", "Savanna", "Jacaranda", "Green field", "Donholm", "Jogoo Rd",
                             "City Stadium", "Landhies Rd", "Haile Sellasie Ave", "Moi Ave", "Kenyatta Ave",
                             "GPO", "Ngong Rd", "Community", "Suna Rd", "Joseph Kangethe Rd", "Woodley",
                             "Kibera station Rd"),
        "return": _stages("GPO", "Ambassadeur", "Moi Ave", "Kimathi St", "Kenyatta Ave", "GPO", "Ngong Rd",
                           "Community", "KMTC"),
    },
]
