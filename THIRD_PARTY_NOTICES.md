# Third-party notices

## stylized-components

The stylized grass, dirt/path blending, flower palette, pine foliage, bark treatment,
rock-trampling behavior, sky palette, anime water surface, blade translucency, and
related assets are adapted from:

- Project: `cortiz2894/stylized-components`
- Author: Christian Ortiz (Cortiz)
- License: MIT

The SimCity DnD implementation is a Three.js WebGPU/TSL port integrated with the
project's streamed terrain chunks, floating origin, editor tiles, and GPU rendering.

### MIT License

Copyright (c) 2026 Christian Ortiz (Cortiz)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## meshoptimizer / gltfpack

Runtime GLBs are optimized offline with `gltfpack` from
[zeux/meshoptimizer](https://github.com/zeux/meshoptimizer), version 1.2.
The tool and meshopt decoder are distributed under the MIT License.

Copyright (c) 2016-2026 Arseny Kapoulkine

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Basis Universal transcoder

Three.js `KTX2Loader` bundles the Basis Universal JavaScript/WASM transcoder
from [BinomialLLC/basis_universal](https://github.com/BinomialLLC/basis_universal).
Basis Universal is licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## Khronos glTF Validator

Runtime asset validation uses the official
[KhronosGroup/glTF-Validator](https://github.com/KhronosGroup/glTF-Validator),
version 2.0.0-dev.3.10. The validator is licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## Stylized Tree

`public/assets/trees/stylized-oak.glb`, including its embedded foliage texture,
is the “Stylized Tree” model by Sketchfab user
[yonimantz](https://sketchfab.com/yonimantz09).

- Source: https://sketchfab.com/3d-models/stylized-tree-6d1aeea748f147789004bc03e1930d32
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Changes: runtime scale, grounding, instancing, stylized lighting, and LOD/proxy
  generation are applied by this project.

## Authored Rocks

The following models and their embedded textures are distributed under their
listed Creative Commons licences. This project grounds, scales, instances, and
generates simplified LOD representations from them at runtime.

- `public/assets/rocks/rock.glb`: “Rock” by
  [azzajess](https://sketchfab.com/azzajess), licensed
  [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
  [Source](https://sketchfab.com/3d-models/rock-e06fc204468d418e906e78b98ae59692)
- `public/assets/rocks/obj_nat_rock_01.glb`: “Obj_Nat_Rock_01” by
  [SaschaHenrichs](https://sketchfab.com/SaschaHenrichs), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  [Source](https://sketchfab.com/3d-models/obj-nat-rock-01-62d63fd7d1dd416aac1496eb19c43cc0)
- `public/assets/rocks/a_simple_rock.glb`: “A Simple Rock” by
  [Ozonek](https://sketchfab.com/ozonek), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  [Source](https://sketchfab.com/3d-models/a-simple-rock-bcfc084c997f4c019d404bb92dcc4d2c)
  Its obsolete specular/glossiness declaration was converted to standard
  metallic/roughness while retaining the embedded diffuse and normal textures.
- `public/assets/rocks/ruined-fence/*.glb`: extracted stones from “Ruined rock fence” by
  [VladNeko](https://sketchfab.com/vlad.neko), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  [Source](https://sketchfab.com/3d-models/ruined-rock-fence-75e2716c378e4a68bac3577303671921)
- `public/assets/rocks/3d_scan_rock.glb`: “3D Scan Rock” by
  [Trey Brown](https://sketchfab.com/treythepunkid), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  [Source](https://sketchfab.com/3d-models/3d-scan-rock-48a05d2336014bd0bd91eb71e68fcb60)

## Low Poly Forest Tree Pack

`public/assets/trees/forest-pack/*.glb`,
`public/assets/rocks/forest-pack/*.glb`, and their offline counterparts are
extracted from “Low Poly Forest Tree Pack” by
[99.Miles](https://sketchfab.com/99.Miles), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
[Source](https://sketchfab.com/3d-models/low-poly-forest-tree-pack-5ff5a51e74324845a4e4905f182dfb2)

The source pack is split offline into four grouped trunk/crown trees and nine
grounded rocks. Only curated individual files enter runtime residency; the
showroom layout and background atlas cards are never published as runtime assets.

## Low Poly Tree Scene Free

`public/assets/trees/tree-scene/*.glb` and
`assets/extracted/trees/low-poly-tree-scene/*.glb` are extracted from “Low Poly
Tree Scene Free” by
[Nicholas-3D](https://sketchfab.com/Nicholas01), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
[Source](https://sketchfab.com/3d-models/low-poly-tree-scene-free-89daa5e21f0d4f08a59dba0d566e88bd)

The original 42.8 MB scene is an offline source only. Its 23 tree roots and two
reusable grass shapes are saved individually; repeated grass placements,
showroom ground, and water are not exported.

## Authored Ground Detail

The following models are licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This project groups
their showroom nodes into grounded, instanced prototypes while retaining their
embedded materials and textures.

- `public/assets/ground/stylized-grass/*.glb`: extracted from “Stylized grass” by
  [Firdaus Sahak](https://sketchfab.com/firdaussahak).
  [Source](https://sketchfab.com/3d-models/stylized-grass-3a5a5c5be677403d9f56e451cd3dd4af)
- `assets/extracted/ground/clover/clover.glb`: extracted from “Clover Grass” by
  [kelvladmail](https://sketchfab.com/kelvladmail).
  [Source](https://sketchfab.com/3d-models/clover-grass-beeff00b4496409da82b7c1a9705039e)
- `public/assets/ground/aquatic/{grass-plant-*,weed-*}.glb` and offline
  counterparts: extracted from “Weeds and grass” by
  [spoon420](https://sketchfab.com/spoon420).
  [Source](https://sketchfab.com/3d-models/weeds-and-grass-7e2b98aab6064d63bb2fc3fda8450c27)
- `public/assets/ground/aquatic/lotus-*.glb` and
  `assets/extracted/ground/lotus/*.glb`: extracted from “LOTUS” by
  [Amagi_Arts](https://sketchfab.com/natsuboy304).
  [Source](https://sketchfab.com/3d-models/lotus-5627ae9572ce419fac75b68a2ac54594)
- `assets/extracted/ground/simple-grass-chunks/*.glb`: extracted from “Simple
  grass chunks” by [3dhdscan](https://sketchfab.com/3dhdscan).
  [Source](https://sketchfab.com/3d-models/simple-grass-chunks-eb4f6dc9d4e3455ea3435385faf58b60)

## Authored Bushes

The following models and their embedded textures are licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This project grounds,
scales, instances, and applies cutout/LOD rendering to them at runtime.

- `public/assets/bushes/stylized_bush.glb`: “Stylized Bush” by
  [Daniel](https://sketchfab.com/danielpetrov).
  [Source](https://sketchfab.com/3d-models/stylized-bush-9d9ce79d3ae040619e96d5b22c7de1a6)
- `public/assets/bushes/small_bush.glb`: “Small bush” by
  [yanix](https://sketchfab.com/yanix).
  [Source](https://sketchfab.com/3d-models/small-bush-f6ed4c70fc024ac88e8e6a19991695af)
- `public/assets/bushes/bush2.glb`: “Bush” by
  [7thFlare](https://sketchfab.com/7thFlare).
  [Source](https://sketchfab.com/3d-models/bush-6f1920d84d5445f9857da7ba8238fd38)
- `public/assets/bushes/bush.glb`: “bush” by
  [lev26](https://sketchfab.com/levandreev23032010).
  [Source](https://sketchfab.com/3d-models/bush-844e6a315757431da97efb5f17383bb5)
- `public/assets/bushes/bamboo_bush.glb`: “Bamboo Bush” by
  [sujirour](https://sketchfab.com/sujirour).
  [Source](https://sketchfab.com/3d-models/bamboo-bush-d0d5eb345ff7420bb7f5c5239fcec637)

## Authored Wildlife

The optional close-wildlife GLBs are flight-only derivatives of models by
[AnimalMesh 3D](https://sketchfab.com/AnimalMesh3D), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

- `public/assets/animals/crow-flight.glb`: “Animated Crow – 3D Animal Model”.
  [Source](https://sketchfab.com/3d-models/animated-crow-3d-animal-model-6e634f78d54341a89bbbb6ee1d24876a)
- `public/assets/animals/seagull-flight.glb`: “Seagull – Stylized Animated 3D
  Model”.
  [Source](https://sketchfab.com/3d-models/seagull-stylized-animated-3d-model-b331b360c0064536a6e517c1a93a349d)

Changes: unused animation clips are removed, legacy specular/glossiness
materials are converted to metallic/roughness, keyframes are resampled,
textures are runtime-compressed, and model scale, flight paths and habitat
selection are applied by this project. The default distant-flock silhouettes
are generated project geometry and do not reuse the authored meshes or
textures.

## simple-cheap-stylized-tree-shader

`public/assets/textures/leaf/foliage_512a.png` and `foliage_512b.png` are the
`texture/512a.png` and `512b.png` files from
`niceandgoodonline/simple-cheap-stylized-tree-shader-issue-demo`, released under
**CC0 1.0 Universal** (public domain dedication — no attribution required; this
note is a courtesy).

The canopy rim term in `createStylizedLeafMaterial` is ported from the CC0 shader
at `godotshaders.com/shader/stylized-fluffy-tree-leaves`, whose page states the
code is CC0. Only the fresnel formula is taken; the billboard and wind terms are
not used, since this project already has its own vertex wind.

Not used: `TheMIU/Stylized-Fluffy-Tree-Shader`. Its shader descends from the
MIT-licensed original on godotshaders, but the repository carries no licence file
of its own, and the godotshaders MIT explicitly excludes images and assets — so
its leaf textures and Illustrator source are not included here.

## stylized-vegetation

The foliage alpha cards in `public/assets/textures/leaf/` are taken unmodified from:

- Project: `ProblematicToucan/stylized-vegetation`
- Author: Gamal Abdul Aziz
- License: MIT

`leaf_card.png` is that project's `Tree/Leaf.png` and `bush_card.png` is its
`Bush/Bushes.png`. Only the textures are used; the project's Unity shader graphs,
FBX meshes and custom lighting HLSL are not included or derived from.

### MIT License

Copyright (c) 2022 Gamal Abdul Aziz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## polygon-clipping

Procedural composition footprints use `polygon-clipping` by Mike Fogel, derived
from Alexander Milevski's Martinez polygon clipping implementation.

The MIT License (MIT)

Copyright (c) 2018 Mike Fogel <mike@fogel.ca>

Copyright (c) 2016 Alexander Milevski <info@w8r.name>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## straight-skeleton

Procedural roofs use the synchronous TypeScript implementation from
`straight-skeleton` version 1.

MIT License

Copyright (c) 2021 vHawk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
