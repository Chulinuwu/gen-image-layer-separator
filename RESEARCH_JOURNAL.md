# Research Draft: Agentic Automation of Commercial Graphic Design via Layer-Wise Decomposition and Cognitive Feedback Loops

## Abstract

This paper presents a novel framework for automating the generation of commercial advertising banners by simulating the cognitive workflow of a professional graphic designer. Unlike traditional "End-to-End" generation models (e.g., Text-to-Image) that often struggle with precise text placement and legibility, our approach adopts a **Layer-Wise Decomposition Strategy**. We separate the generation of **Visual Components** (AI-generated assets with automated background removal) from **Text Graphics** (Typography). The core contribution is an **Agentic Text Layout Engine** that embeds explicit design rules—spatial awareness, safety zones, and typographic hierarchy—into the generation process. Furthermore, we introduce an **Iterative Feedback Loop** where a secondary AI agent acts as an "Art Director," critiquing and refining layouts in real-time to ensure aesthetic integrity and prevent visual conflicts.

---

## 1. Introduction

The automation of graphic design faces a "Compositional Challenge." While modern diffusion models excel at generating pixels, they lack the semantic understanding required to compose complex commercial layouts where text must coexist harmoniously with subject matter. A human designer does not paint pixels randomly; they work in **Layers** and follow strict **Design Rules**.

Our system mimics this human cognition by decomposing the design task into two parallel workflows:

1.  **Component Generation:** Creating visual assets (models, products).
2.  **Text Composition:** Applying typography with strict spatial constraints.

## 2. Methodology: The Layer-Wise Cognitive Architecture

### 2.1 Component Generation Module (The "Asset Creator")

Instead of generating a flat image, the system generates distinct visual elements.

- **Generation:** Utilizes advanced Text-to-Image models (e.g., Imagen/Stable Diffusion) to create specific subjects (e.g., "A happy Thai woman holding a phone").
- **Isolation (Die-cut):** Automatically removes backgrounds to create transparent PNG assets (`.png`), effectively creating a "Digital Sticker" that can be layered onto any background without bounding box conflicts.

### 2.2 Intelligent Text Layout Engine (The "Typesetter")

This module simulates the cognitive process of a designer planning a layout. It does not guess positions; it calculates them based on **Spatial Analysis**.

#### A. Spatial Awareness & Safety Zones

Before text placement, the system performs a grid-based analysis of the base image:

- **Scanning:** Segments the image into columns (Left, Center, Right).
- **No-Go Zone Detection:** Identifies critical subject areas (faces, products) that must not be obscured. These coordinates are passed as hard constraints to the Layout Agent.
- **Safe Zone Identification:** target areas where text can exist freely (e.g., clear sky, empty wall).

#### B. Typographic Cognition

The Layout Agent is instructed with explicit typographic rules, akin to a Design System:

- **Smart Line Breaking:** Long sentences are logically split into stacked layers to fit narrow safe zones, preventing "orphaned words" or overlap.
- **Fluid Hierarchy:** Distinct styling for Headlines (Display Fonts), Subheaders, and Call-to-Actions.
- **Context-Aware Styling:** Dynamic selection of typography styles (e.g., Stroke/Outline, Gradients) based on background complexity to maximize contrast (Commercial Grade aesthetics).
- **Localization:** Specific handling of Thai typography (e.g., preserving vowel space, selecting 'Kanit' or 'Mitr' fonts).

### 2.3 The Feedback Loop (The "Critique Mechanism")

A critical innovation is the **Self-Refinement Loop**. The system does not blindly accept the first output.

1.  **Draft Generation:** The Layout Agent proposes coordinates and styles.
2.  **Simulation (SVG Rendering):** A server-side SVG engine renders a "Phantom Preview" of the proposed layout.
3.  **Art Director Review:** A secondary VLM (Vision-Language Model) examines this preview against the original brief.
    - _Constraint Check:_ "Is text overlapping the face?"
    - _Readability Check:_ "Is the contrast sufficient?"
4.  **Refinement:** If the Reviewer detects a fail state, it triggers a regeneration with specific corrective feedback (e.g., "Shift headline 50px right").

## 3. Human-AI Collaboration (The Interactive Editor)

Recognizing that design is subjective, we implement a **Web-Based Layer Editor** (Canvas API).

- **Full Manipulability:** Users can intervene at the layer level—dragging, resizing, or changing fonts/colors of the AI-generated elements.
- **Advanced Rendering:** The client-side engine supports commercial styling attributes (Stroke, Drop Shadow) identical to the backend generation, ensuring WYSIWYG fidelity.

## 4. Experimental Phase: Post-Composition Refinement

We are currently investigating a final **"Harmonization Pass."**

- **Workflow:** The composed, layered image (Text + Components + Background) is exported as a flat raster.
- **AI Polish:** This flat image is fed back into an Image-to-Image model with low denoising strength.
- **Goal:** To hallucinate subtle lighting interactions (e.g., casting shadows from text onto the background, color grading) that unifies the disparate layers into a cohesive, photorealistic final image.

## 5. Future Work: The Intelligent Asset Retrieval System (Vector Database Integration)

Scale is the ultimate challenge. Generating bespoke components for every single ad request is computationally expensive and introduces variability (e.g., a mascot's face changing slightly between generations). To address this, we propose a **Retrieval-Augmented Generation (RAG)** approach for visual assets.

### 5.1 The "Asset Library" Architecture

We aim to transition from a "Generate-Once-Discard" model to a **"Generate-And-Catalog"** model.

1.  **Component Indexing:** Every generated component (e.g., "Red Sneaker", "Summer Mascot") is passed through an embedding model (e.g., CLIP or geometric embeddings) and stored in a **Vector Database** (e.g., Pinecone/Milvus) along with its semantic description.
2.  **Semantic Retrieval:** When the Layout Agent suggests a component (e.g., "Blue Surfboard"), the system first query-vectors the database.
    - _Hit:_ If a highly similar asset exists (>0.85 similarity), it is retrieved and reused.
    - _Miss:_ If no suitable asset is found, the GenAI pipeline is triggered to create a new one, which is then indexed for future use.

### 5.2 Benefits of Component Reusability

- **Brand Consistency:** Ensures that key brand assets (logos, mascots, specific products) remain identical across different campaigns, solving the "hallucination drift" problem.
- **Latency Reduction:** Searching a vector index takes milliseconds, whereas generating and die-cutting a new image takes seconds.
- **Cost Optimization:** Drastically reduces API calls to expensive Image Generation models by recycling high-quality assets.

## 6. Conclusion

By shifting from "Image Generation" to "Design Composition," we achieve a system that respects the constraints of commercial advertising. The combination of **Layer Isolation**, **Cognitive Layout Rules**, **Iterative Critique**, and the proposed **Vector-Based Asset Retrieval** allows AI to function not just as a tool, but as a scalable, intelligent design partner capable of logical spatial reasoning and long-term asset management.
