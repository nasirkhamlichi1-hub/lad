/* Year 10 Study App — curriculum content
 * Subjects: Science, Maths, English, Geography, Business, Design & Technology
 * Each topic: { id, title, summary, notes (array of {h, p} sections), questions[] }
 * Question types: "mcq" (options + answerIndex), "written" (modelAnswer + marks)
 */
window.CURRICULUM = {
  science: {
    name: "Science",
    icon: "🔬",
    colour: "#2e9e6b",
    blurb: "Biology, Chemistry & Physics",
    topics: [
      {
        id: "cells",
        title: "Cells & Transport",
        summary: "Cell structure, and how substances move by diffusion, osmosis and active transport.",
        notes: [
          { h: "Cell types", p: "All living things are made of cells. <b>Eukaryotic</b> cells (animals, plants) have a nucleus that holds DNA. <b>Prokaryotic</b> cells (bacteria) have no nucleus — their genetic material floats freely as a single loop, plus small rings called plasmids." },
          { h: "Key structures", p: "<b>Nucleus</b> — controls the cell and holds genetic material. <b>Cytoplasm</b> — jelly where reactions happen. <b>Cell membrane</b> — controls what enters/leaves. <b>Mitochondria</b> — release energy in respiration. <b>Ribosomes</b> — make proteins. Plant cells <i>also</i> have a <b>cell wall</b> (support), <b>chloroplasts</b> (photosynthesis) and a large <b>vacuole</b> (keeps the cell firm)." },
          { h: "Diffusion", p: "Diffusion is the <b>net movement of particles from a high to a low concentration</b> (down a concentration gradient). It is passive — it needs no energy. Example: oxygen diffusing from the alveoli in your lungs into the blood." },
          { h: "Osmosis", p: "Osmosis is the movement of <b>water</b> across a <b>partially permeable membrane</b>, from a dilute solution (lots of water) to a concentrated solution (less water). Root hair cells absorb water by osmosis." },
          { h: "Active transport", p: "Active transport moves particles <b>against</b> the concentration gradient (low → high). This needs <b>energy from respiration</b>. Example: roots absorbing mineral ions from very dilute soil water." },
          { h: "Surface area to volume", p: "Small cells and specialised exchange surfaces (lungs, gills, intestines) are folded to give a <b>large surface area</b>, a <b>thin</b> barrier and a good blood supply — this speeds up exchange." }
        ],
        questions: [
          { type: "mcq", q: "Which structure is found in a plant cell but NOT an animal cell?", options: ["Mitochondria", "Ribosome", "Chloroplast", "Cell membrane"], answerIndex: 2 },
          { type: "mcq", q: "Osmosis is the movement of…", options: ["Any particle, high to low concentration", "Water, across a partially permeable membrane", "Ions, using energy", "Oxygen into the lungs"], answerIndex: 1 },
          { type: "mcq", q: "Active transport is different from diffusion because it…", options: ["Moves water only", "Needs energy and goes against the gradient", "Is always faster", "Happens only in plants"], answerIndex: 1 },
          { type: "written", q: "Explain why active transport requires energy but diffusion does not. (3 marks)", marks: 3, modelAnswer: "Diffusion moves particles DOWN a concentration gradient (high to low), which happens naturally, so no energy is needed. Active transport moves particles AGAINST the gradient (low to high). Moving particles the 'wrong' way is not natural, so energy released by respiration (from mitochondria) is required." },
          { type: "written", q: "Describe two ways an exchange surface is adapted for efficient diffusion. (2 marks)", marks: 2, modelAnswer: "Any two of: large surface area (e.g. folds/villi) so more particles cross at once; thin membrane / short diffusion distance so particles cross quickly; good blood supply to maintain a steep concentration gradient; ventilation/moisture." }
        ]
      },
      {
        id: "atoms",
        title: "Atomic Structure",
        summary: "Inside the atom: protons, neutrons, electrons, isotopes and the periodic table.",
        notes: [
          { h: "The atom", p: "Atoms have a tiny central <b>nucleus</b> containing <b>protons</b> (charge +1) and <b>neutrons</b> (charge 0). <b>Electrons</b> (charge −1) orbit in shells. Atoms are neutral overall because the number of protons = the number of electrons." },
          { h: "Mass & atomic number", p: "The <b>atomic (proton) number</b> is the number of protons — it defines the element. The <b>mass number</b> = protons + neutrons. Number of neutrons = mass number − atomic number." },
          { h: "Isotopes", p: "<b>Isotopes</b> are atoms of the same element with the <b>same number of protons but a different number of neutrons</b>. They have the same chemistry but a different mass. Example: carbon‑12 and carbon‑14." },
          { h: "Electron shells", p: "Electrons fill shells from the inside out: <b>2, 8, 8…</b>. The number of electrons in the outer shell equals the group number and controls how the element reacts." },
          { h: "The periodic table", p: "Elements are arranged in order of atomic number. <b>Groups</b> (columns) share the same number of outer electrons and similar properties. <b>Periods</b> (rows) show one shell being filled. Metals are on the left, non‑metals on the right." }
        ],
        questions: [
          { type: "mcq", q: "The mass number of an atom is the number of…", options: ["Protons only", "Electrons + protons", "Protons + neutrons", "Neutrons only"], answerIndex: 2 },
          { type: "mcq", q: "Isotopes of an element have the same number of…", options: ["Neutrons", "Protons", "Mass", "Shells that are full"], answerIndex: 1 },
          { type: "mcq", q: "An atom has atomic number 11 and mass number 23. How many neutrons?", options: ["11", "12", "23", "34"], answerIndex: 1 },
          { type: "written", q: "Define the term 'isotope'. (2 marks)", marks: 2, modelAnswer: "Atoms of the same element (same number of protons / same atomic number) that have a different number of neutrons (and therefore a different mass number)." },
          { type: "written", q: "An atom is neutral. Explain why, in terms of subatomic particles. (2 marks)", marks: 2, modelAnswer: "It has an equal number of protons (charge +1) and electrons (charge −1). The positive and negative charges cancel out, so the overall charge is zero." }
        ]
      },
      {
        id: "energy",
        title: "Energy Stores & Transfers",
        summary: "Energy stores, transfers, efficiency and reducing waste.",
        notes: [
          { h: "Energy stores", p: "Energy is stored in different ways: <b>kinetic</b> (movement), <b>gravitational potential</b> (height), <b>elastic potential</b> (stretched/squashed), <b>chemical</b> (fuels, food, batteries), <b>thermal</b> (hot objects) and <b>nuclear</b>." },
          { h: "Transfers", p: "Energy can be transferred <b>mechanically</b> (a force moving), <b>electrically</b> (charge moving), by <b>heating</b>, or by <b>radiation</b> (e.g. light/sound). Energy is <b>conserved</b> — it cannot be created or destroyed, only shifted between stores." },
          { h: "Efficiency", p: "In every transfer some energy is <b>dissipated</b> (wasted), usually as thermal energy to the surroundings. <b>Efficiency = useful energy out ÷ total energy in</b> (× 100 for a %). A more efficient device wastes less." },
          { h: "Reducing waste", p: "Wasted energy is reduced by <b>lubrication</b> (less friction), <b>insulation</b> (less heat loss) and streamlining. Thicker walls and materials with low thermal conductivity keep buildings warm." }
        ],
        questions: [
          { type: "mcq", q: "A ball is held high above the ground. Which store does it mainly have?", options: ["Kinetic", "Elastic potential", "Gravitational potential", "Nuclear"], answerIndex: 2 },
          { type: "mcq", q: "A lamp takes in 100 J and gives out 20 J of light. Its efficiency is…", options: ["20%", "80%", "120%", "5%"], answerIndex: 0 },
          { type: "written", q: "State the principle of conservation of energy. (1 mark)", marks: 1, modelAnswer: "Energy cannot be created or destroyed, only transferred from one store to another (the total stays the same)." },
          { type: "written", q: "Suggest two ways to reduce energy wasted by a moving machine. (2 marks)", marks: 2, modelAnswer: "Lubricate moving parts to reduce friction (less energy wasted as heat/sound); insulate hot parts / streamline the design to reduce air resistance." }
        ]
      }
    ]
  },

  maths: {
    name: "Maths",
    icon: "➗",
    colour: "#3b6fe0",
    blurb: "Number, Algebra & Geometry",
    topics: [
      {
        id: "algebra",
        title: "Algebra Basics",
        summary: "Simplifying, expanding brackets, factorising and solving equations.",
        notes: [
          { h: "Collecting like terms", p: "Only add/subtract terms with the <b>same letter and power</b>. e.g. 3x + 5x = 8x, but 3x + 5x² cannot be combined." },
          { h: "Expanding brackets", p: "Multiply everything inside by the term outside: 3(x + 4) = 3x + 12. For two brackets use <b>FOIL</b>: (x + 2)(x + 3) = x² + 3x + 2x + 6 = x² + 5x + 6." },
          { h: "Factorising", p: "The reverse of expanding — take out the highest common factor: 6x + 9 = 3(2x + 3). Quadratics: x² + 5x + 6 = (x + 2)(x + 3) — find two numbers that multiply to 6 and add to 5." },
          { h: "Solving equations", p: "Do the <b>same thing to both sides</b> to get the letter on its own. 2x + 3 = 11 → subtract 3 → 2x = 8 → divide by 2 → x = 4. Always check by substituting back." }
        ],
        questions: [
          { type: "mcq", q: "Simplify: 4a + 7a − 2a", options: ["9a", "13a", "11a", "5a"], answerIndex: 0 },
          { type: "mcq", q: "Expand: 5(2x − 3)", options: ["10x − 3", "10x − 15", "7x − 8", "10x + 15"], answerIndex: 1 },
          { type: "mcq", q: "Solve: 3x + 4 = 19", options: ["x = 5", "x = 7", "x = 6", "x = 15"], answerIndex: 0 },
          { type: "written", q: "Factorise fully: 8x + 12. (1 mark)", marks: 1, modelAnswer: "The highest common factor of 8 and 12 is 4, so 8x + 12 = 4(2x + 3)." },
          { type: "written", q: "Solve 2(x + 3) = 16, showing each step. (3 marks)", marks: 3, modelAnswer: "Expand: 2x + 6 = 16. Subtract 6 from both sides: 2x = 10. Divide by 2: x = 5. (Check: 2(5+3)=16 ✓)" }
        ]
      },
      {
        id: "percentages",
        title: "Percentages",
        summary: "Percentage of an amount, increase/decrease and reverse percentages.",
        notes: [
          { h: "Percentage of an amount", p: "To find 15% of 80: 15 ÷ 100 = 0.15, then 0.15 × 80 = 12. A percentage is just 'out of 100'." },
          { h: "Multipliers", p: "Increase by 20% → multiply by <b>1.20</b>. Decrease by 20% → multiply by <b>0.80</b>. This is the fastest method and works for repeated (compound) change." },
          { h: "Percentage change", p: "% change = (change ÷ original) × 100. If a £40 item rises to £50, change = 10, so 10/40 × 100 = 25% increase." },
          { h: "Reverse percentages", p: "If a price is £60 <i>after</i> a 20% increase, that £60 is 120% of the original. Original = 60 ÷ 1.20 = £50. Always divide by the multiplier to go backwards." }
        ],
        questions: [
          { type: "mcq", q: "What is 30% of 150?", options: ["30", "45", "50", "60"], answerIndex: 1 },
          { type: "mcq", q: "To increase a number by 8% you multiply by…", options: ["8", "0.08", "1.08", "0.92"], answerIndex: 2 },
          { type: "mcq", q: "A coat costs £72 after a 20% off sale. Original price?", options: ["£86.40", "£90", "£92", "£57.60"], answerIndex: 1 },
          { type: "written", q: "A phone's value falls from £400 to £340. Work out the percentage decrease. (2 marks)", marks: 2, modelAnswer: "Change = 400 − 340 = 60. Percentage decrease = (60 ÷ 400) × 100 = 15%." },
          { type: "written", q: "£250 is invested at 3% compound interest per year. Find its value after 2 years. (2 marks)", marks: 2, modelAnswer: "Multiply by 1.03 each year: 250 × 1.03² = 250 × 1.0609 = £265.23 (to the nearest penny)." }
        ]
      },
      {
        id: "pythagoras",
        title: "Pythagoras' Theorem",
        summary: "Finding a missing side in a right‑angled triangle.",
        notes: [
          { h: "The rule", p: "In a <b>right‑angled triangle</b>: a² + b² = c², where <b>c is the hypotenuse</b> (the longest side, opposite the right angle)." },
          { h: "Finding the hypotenuse", p: "Add the squares of the two shorter sides, then square‑root. If a = 3 and b = 4: c² = 9 + 16 = 25, so c = √25 = 5." },
          { h: "Finding a shorter side", p: "<b>Subtract</b> instead. If the hypotenuse is 13 and one side is 5: b² = 13² − 5² = 169 − 25 = 144, so b = 12." },
          { h: "When to use it", p: "Only for right‑angled triangles, when you know two sides and want the third. It does not need any angles other than the 90°." }
        ],
        questions: [
          { type: "mcq", q: "Which side is the hypotenuse?", options: ["The shortest side", "The side opposite the right angle", "Any side you choose", "The vertical side"], answerIndex: 1 },
          { type: "mcq", q: "Sides are 6 cm and 8 cm. Find the hypotenuse.", options: ["10 cm", "14 cm", "48 cm", "12 cm"], answerIndex: 0 },
          { type: "written", q: "A right‑angled triangle has hypotenuse 17 cm and one side 8 cm. Find the other side. (3 marks)", marks: 3, modelAnswer: "b² = 17² − 8² = 289 − 64 = 225. b = √225 = 15 cm." },
          { type: "written", q: "A ladder 5 m long leans so its base is 3 m from a wall. How high up the wall does it reach? (2 marks)", marks: 2, modelAnswer: "height² = 5² − 3² = 25 − 9 = 16. height = √16 = 4 m." }
        ]
      }
    ]
  },

  english: {
    name: "English",
    icon: "📖",
    colour: "#c2506b",
    blurb: "Language & Literature skills",
    topics: [
      {
        id: "techniques",
        title: "Language Techniques",
        summary: "Spotting and analysing techniques writers use for effect.",
        notes: [
          { h: "Key techniques", p: "<b>Simile</b> — comparing with 'like'/'as' (as brave as a lion). <b>Metaphor</b> — saying something <i>is</i> something else (the classroom was a zoo). <b>Personification</b> — giving human qualities to non‑human things (the wind whispered). <b>Alliteration</b> — repeated starting sounds (silent, sullen sea)." },
          { h: "More techniques", p: "<b>Onomatopoeia</b> — words that sound like their meaning (crash, buzz). <b>Hyperbole</b> — deliberate exaggeration (I've told you a million times). <b>Rhetorical question</b> — a question for effect, not an answer. <b>Emotive language</b> — words chosen to stir feelings." },
          { h: "Analysing, not just spotting", p: "Marks come from <b>effect</b>, not labels. Say <i>what</i> the technique is, quote it, then explain <b>how it makes the reader feel or think</b>. 'The metaphor \"a prison of paperwork\" suggests the character feels trapped and overwhelmed.'" },
          { h: "Zooming in on words", p: "Pick a single powerful word and analyse its <b>connotations</b> (associations). 'Stormed' suggests anger and force, unlike 'walked' — this shows the character's rage." }
        ],
        questions: [
          { type: "mcq", q: "'The stars danced in the sky' is an example of…", options: ["Simile", "Personification", "Alliteration", "Hyperbole"], answerIndex: 1 },
          { type: "mcq", q: "'As cold as ice' is a…", options: ["Metaphor", "Simile", "Onomatopoeia", "Rhetorical question"], answerIndex: 1 },
          { type: "written", q: "Identify the technique in 'the thunder growled angrily' and explain its effect. (3 marks)", marks: 3, modelAnswer: "Personification — the thunder is given the human/animal quality of growling angrily. This makes the storm feel alive, threatening and powerful, building tension and making the reader feel uneasy or afraid." },
          { type: "written", q: "Explain why analysing a writer's word choice earns more marks than just naming a technique. (2 marks)", marks: 2, modelAnswer: "Naming a technique only shows recognition. Analysing the specific word choice and its effect on the reader shows understanding of HOW the writer creates meaning or mood, which is what the mark scheme rewards." }
        ]
      },
      {
        id: "peel",
        title: "Essay Structure (PEEL)",
        summary: "Building clear, analytical paragraphs.",
        notes: [
          { h: "What PEEL stands for", p: "<b>P</b>oint — your main idea / answer to the question. <b>E</b>vidence — a short quotation. <b>E</b>xplain — analyse how the evidence proves the point (techniques, word choice, effect). <b>L</b>ink — back to the question or on to the next idea." },
          { h: "Strong points", p: "A good point directly answers the question and takes a clear position. Weak: 'The writer uses language.' Strong: 'The writer presents the city as dangerous and uncaring.'" },
          { h: "Embedding quotations", p: "Weave short quotes into your sentence rather than dropping them in: The narrator's description of the 'grey, lifeless streets' creates a bleak mood. Keep quotations short — a few words is plenty." },
          { h: "Analysis is the heart", p: "Spend most of the paragraph on <b>Explain</b>. Consider technique, connotations, and the effect on the reader — and, if relevant, the writer's intention or context." }
        ],
        questions: [
          { type: "mcq", q: "In PEEL, what does the second E stand for?", options: ["Evaluate", "Explain", "Emphasise", "Example"], answerIndex: 1 },
          { type: "mcq", q: "Which is the strongest 'Point'?", options: ["The writer uses words.", "There is a quote here.", "The writer presents the sea as a threatening force.", "This paragraph is about the sea."], answerIndex: 2 },
          { type: "written", q: "Write a PEEL paragraph analysing the phrase 'a heart of stone' used to describe a character. (4 marks)", marks: 4, modelAnswer: "Point: The writer presents the character as cold and unfeeling. Evidence: They are described as having 'a heart of stone'. Explain: This metaphor compares the character's heart to stone, which is hard, cold and lifeless, suggesting they are incapable of kindness or emotion and cannot be softened. The reader is positioned to dislike or fear them. Link: This introduces the theme of cruelty that runs through the text." },
          { type: "written", q: "Why should quotations be kept short and embedded? (2 marks)", marks: 2, modelAnswer: "Short, embedded quotations show you can select precise, relevant evidence and keep the focus on analysis rather than copying. Long quotes waste time and often go unanalysed, which gains no marks." }
        ]
      }
    ]
  },

  geography: {
    name: "Geography",
    icon: "🌍",
    colour: "#0f9aa8",
    blurb: "Physical & Human geography",
    topics: [
      {
        id: "rivers",
        title: "Rivers & Landforms",
        summary: "How rivers erode, transport and deposit to create landforms.",
        notes: [
          { h: "The long profile", p: "A river's course runs from source (upland) to mouth (sea). <b>Upper course</b>: steep, narrow, fast in flood. <b>Middle course</b>: wider, meanders. <b>Lower course</b>: wide, flat, deposits sediment." },
          { h: "Erosion processes", p: "<b>Hydraulic action</b> — force of water breaks rock. <b>Abrasion</b> — rocks scrape the bed. <b>Attrition</b> — rocks knock together and get smaller/rounder. <b>Solution</b> — acidic water dissolves rock." },
          { h: "Transport & deposition", p: "Load is carried by traction, saltation, suspension and solution. When a river <b>slows down</b> (less energy) it <b>deposits</b> its load — largest particles first." },
          { h: "Landforms", p: "<b>Waterfalls & gorges</b> form where hard rock lies over soft rock. <b>Meanders</b> form as water erodes the outer bank and deposits on the inner bank. An <b>ox‑bow lake</b> forms when a meander neck is cut through. <b>Floodplains and levées</b> form from deposition in the lower course." }
        ],
        questions: [
          { type: "mcq", q: "Which process makes rocks rounder and smaller as they collide?", options: ["Hydraulic action", "Abrasion", "Attrition", "Solution"], answerIndex: 2 },
          { type: "mcq", q: "An ox‑bow lake forms from a…", options: ["Waterfall", "Cut‑off meander", "Delta", "Levée"], answerIndex: 1 },
          { type: "written", q: "Explain how a waterfall forms. (4 marks)", marks: 4, modelAnswer: "A band of hard rock lies over softer rock. The softer rock is eroded faster (by hydraulic action and abrasion), undercutting the hard rock. This forms an overhang, which eventually collapses. A deep plunge pool forms at the base from the falling water. Over time the waterfall retreats upstream, leaving a steep‑sided gorge." },
          { type: "written", q: "Why does a river deposit its load? (2 marks)", marks: 2, modelAnswer: "When a river loses energy — for example where it slows down, becomes shallower, or enters the sea/a lake — it can no longer carry its load, so material is deposited, heaviest first." }
        ]
      },
      {
        id: "tectonics",
        title: "Tectonic Hazards",
        summary: "Plate boundaries, earthquakes, volcanoes and reducing risk.",
        notes: [
          { h: "Plate tectonics", p: "Earth's crust is split into <b>tectonic plates</b> that float on the mantle and move a few cm a year, driven by convection currents. Most hazards happen at <b>plate boundaries</b>." },
          { h: "Boundary types", p: "<b>Constructive (divergent)</b> — plates move apart, magma rises (gentle volcanoes). <b>Destructive (convergent)</b> — plates collide; oceanic plate subducts, causing violent volcanoes and earthquakes. <b>Conservative</b> — plates slide past; earthquakes but no volcanoes." },
          { h: "Effects", p: "<b>Primary effects</b> happen immediately (buildings collapse, deaths). <b>Secondary effects</b> follow (fires, disease, tsunamis, homelessness). Effects are usually worse in <b>lower‑income countries</b> with weaker buildings and services." },
          { h: "Managing risk", p: "<b>Prediction</b> (monitoring), <b>protection</b> (earthquake‑proof buildings), <b>planning</b> (drills, hazard maps) and <b>preparation</b> (emergency kits) reduce the impact. You cannot stop the hazard, only reduce its effects." }
        ],
        questions: [
          { type: "mcq", q: "At which boundary do plates slide past each other?", options: ["Constructive", "Destructive", "Conservative", "Collision"], answerIndex: 2 },
          { type: "mcq", q: "A tsunami after an earthquake is an example of a…", options: ["Primary effect", "Secondary effect", "Plate boundary", "Prediction"], answerIndex: 1 },
          { type: "written", q: "Explain why earthquake effects are often worse in lower‑income countries. (4 marks)", marks: 4, modelAnswer: "Lower‑income countries often have poorly constructed buildings that collapse easily, causing more deaths and injuries. They have less money for prediction, monitoring and earthquake‑proofing. Emergency services and healthcare may be under‑resourced, so rescue and treatment are slower. Rebuilding is slow, deepening long‑term impacts like homelessness and disease." },
          { type: "written", q: "Give two ways people can prepare for earthquakes. (2 marks)", marks: 2, modelAnswer: "Any two of: practise earthquake drills; build earthquake‑resistant buildings; prepare emergency kits (water, food, torch); create and follow hazard maps / evacuation plans; educate people on what to do." }
        ]
      }
    ]
  },

  business: {
    name: "Business",
    icon: "💼",
    colour: "#d08a1e",
    blurb: "Enterprise, marketing & finance",
    topics: [
      {
        id: "ownership",
        title: "Types of Business Ownership",
        summary: "Sole traders, partnerships and companies — and limited liability.",
        notes: [
          { h: "Sole trader", p: "Owned and run by <b>one person</b>. Easy and cheap to set up, keeps all profit and makes all decisions. But has <b>unlimited liability</b> (personally responsible for all debts) and may struggle to raise money." },
          { h: "Partnership", p: "Owned by <b>2–20 partners</b> who share decisions, profits and workload, and can raise more money together. But disagreements can arise and most partnerships also have <b>unlimited liability</b>." },
          { h: "Limited companies", p: "A <b>private limited company (Ltd)</b> or <b>public limited company (plc)</b> is a separate legal body. Owners are <b>shareholders</b> with <b>limited liability</b> — they can only lose what they invested. Companies can raise more capital but face more rules and must publish accounts." },
          { h: "Limited vs unlimited liability", p: "<b>Unlimited liability</b> means the owner's personal possessions are at risk if the business fails. <b>Limited liability</b> protects the owner — the business's debts are its own. This is a key reason many owners incorporate." }
        ],
        questions: [
          { type: "mcq", q: "Which owner has unlimited liability?", options: ["Shareholder in a plc", "Sole trader", "Ltd company owner", "None of these"], answerIndex: 1 },
          { type: "mcq", q: "Owners of a limited company are called…", options: ["Partners", "Sole traders", "Shareholders", "Suppliers"], answerIndex: 2 },
          { type: "written", q: "Explain one advantage of limited liability for a business owner. (3 marks)", marks: 3, modelAnswer: "Limited liability means the owner can only lose the money they invested, not their personal assets (like their house). This reduces personal financial risk, so the owner is more willing to invest and take business risks, encouraging growth." },
          { type: "written", q: "Give one advantage and one disadvantage of being a sole trader. (2 marks)", marks: 2, modelAnswer: "Advantage: keeps all the profit / makes all decisions / easy to set up. Disadvantage: unlimited liability / hard to raise finance / heavy workload with no one to share it." }
        ]
      },
      {
        id: "marketing-mix",
        title: "The Marketing Mix (4 Ps)",
        summary: "Product, Price, Place and Promotion working together.",
        notes: [
          { h: "Product", p: "The good or service itself — its design, quality, features and how it meets customer needs. Businesses use the <b>product life cycle</b> (introduction, growth, maturity, decline) and extension strategies." },
          { h: "Price", p: "How much customers pay. Strategies include <b>penetration</b> (low price to enter a market), <b>skimming</b> (high launch price), <b>competitive</b> pricing and <b>cost‑plus</b> pricing. Price must match the product and target market." },
          { h: "Place", p: "How and where the product reaches the customer — shops, online, wholesalers, or direct. Good 'place' means the product is available when and where customers want it." },
          { h: "Promotion", p: "How the business communicates with customers: advertising, social media, sponsorship, sales promotions (offers) and public relations. It raises awareness and persuades people to buy." },
          { h: "Working together", p: "The 4 Ps must be <b>consistent</b>. A premium product needs a higher price, selective place and stylish promotion — mismatched Ps confuse customers." }
        ],
        questions: [
          { type: "mcq", q: "'Buy one get one free' is an example of which P?", options: ["Product", "Price", "Place", "Promotion"], answerIndex: 3 },
          { type: "mcq", q: "Setting a low price to enter a new market is called…", options: ["Skimming", "Penetration pricing", "Cost‑plus", "Competitive pricing"], answerIndex: 1 },
          { type: "written", q: "Explain why the 4 Ps of the marketing mix must work together. (3 marks)", marks: 3, modelAnswer: "Each P sends a message about the brand. If they are inconsistent — e.g. a luxury product sold cheaply in discount shops — customers are confused and the brand image is damaged. When product, price, place and promotion match the target market, the product is more likely to sell successfully." },
          { type: "written", q: "Suggest a suitable pricing strategy for a brand‑new, unique gadget, and justify it. (2 marks)", marks: 2, modelAnswer: "Price skimming — set a high launch price. Because the gadget is new and unique with little competition, keen early buyers will pay more, letting the business recover development costs before lowering the price later." }
        ]
      }
    ]
  },

  dt: {
    name: "Design & Technology",
    icon: "🛠️",
    colour: "#7a5cd0",
    blurb: "Design, materials & sustainability",
    topics: [
      {
        id: "design-process",
        title: "The Design Process",
        summary: "From identifying a need to evaluating a final product.",
        notes: [
          { h: "Iterative design", p: "Designing is a <b>cycle</b>, not a straight line: <b>explore → create → evaluate</b>, then repeat. Each loop improves the design based on testing and feedback." },
          { h: "Design brief & specification", p: "A <b>brief</b> is a short statement of the problem and who it's for. A <b>specification</b> lists measurable requirements (size, cost, materials, safety) the product must meet — used later to judge success." },
          { h: "Research", p: "<b>Primary research</b> = first‑hand (surveys, interviews, testing). <b>Secondary research</b> = existing sources (websites, existing products). Analysing existing products is called <b>product analysis</b>." },
          { h: "Prototyping & testing", p: "Build <b>prototypes</b> or models to test ideas cheaply before final manufacture. Gather <b>user feedback</b> and test against the specification, then improve." },
          { h: "Evaluating", p: "Compare the final product with the specification. Identify what works, what doesn't, and how it could be improved — this feeds the next iteration." }
        ],
        questions: [
          { type: "mcq", q: "A survey you carry out yourself is an example of…", options: ["Secondary research", "Primary research", "A specification", "A prototype"], answerIndex: 1 },
          { type: "mcq", q: "The document listing measurable requirements is the…", options: ["Design brief", "Specification", "Prototype", "Evaluation"], answerIndex: 1 },
          { type: "written", q: "Explain why designers make prototypes before manufacturing. (3 marks)", marks: 3, modelAnswer: "Prototypes let designers test whether an idea actually works and gather user feedback before committing to expensive full production. Problems can be found and fixed cheaply and quickly, reducing the risk of costly mistakes and improving the final product." },
          { type: "written", q: "What is the difference between a design brief and a specification? (2 marks)", marks: 2, modelAnswer: "A design brief is a short statement of the problem and the target user. A specification is a detailed, measurable list of requirements (e.g. size, cost, materials) the product must meet, which is used to evaluate success." }
        ]
      },
      {
        id: "sustainability",
        title: "Sustainability & the 6 Rs",
        summary: "Designing to reduce environmental impact.",
        notes: [
          { h: "Why it matters", p: "Making and disposing of products uses <b>finite resources</b> and energy, and creates waste and pollution. Sustainable design meets today's needs without harming future generations." },
          { h: "The 6 Rs", p: "<b>Rethink</b> (is there a better approach?), <b>Refuse</b> (avoid unnecessary materials), <b>Reduce</b> (use less material/energy), <b>Reuse</b> (use again for the same or new purpose), <b>Repair</b> (fix rather than replace) and <b>Recycle</b> (reprocess materials)." },
          { h: "Materials & energy", p: "Choosing <b>renewable</b> or <b>recycled</b> materials, and reducing 'material miles' (transport), lowers impact. Products designed to be <b>easy to disassemble</b> are easier to repair and recycle." },
          { h: "Product life cycle", p: "A <b>life cycle assessment (LCA)</b> looks at impact across raw materials, manufacture, use and disposal. Designers aim to cut impact at every stage — e.g. energy‑efficient use and recyclable end‑of‑life." }
        ],
        questions: [
          { type: "mcq", q: "Which of the 6 Rs means fixing a product instead of throwing it away?", options: ["Reduce", "Repair", "Refuse", "Recycle"], answerIndex: 1 },
          { type: "mcq", q: "'Material miles' refers to…", options: ["How strong a material is", "How far materials are transported", "How much a material costs", "How recyclable it is"], answerIndex: 1 },
          { type: "written", q: "Explain how designing a product to be easily taken apart supports sustainability. (3 marks)", marks: 3, modelAnswer: "If a product is easy to disassemble, broken parts can be repaired or replaced rather than binning the whole product, extending its life. At the end of life, the different materials can be separated and recycled more easily, reducing waste sent to landfill and saving finite resources." },
          { type: "written", q: "Describe two ways a designer could reduce a product's environmental impact. (2 marks)", marks: 2, modelAnswer: "Any two of: use recycled/renewable materials; reduce the amount of material used; design for repair or recycling; use less energy in manufacture; source materials locally to cut transport (material miles)." }
        ]
      }
    ]
  }
};
