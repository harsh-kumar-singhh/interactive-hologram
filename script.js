import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// --------------------------------------------------
// SUPABASE
// --------------------------------------------------

const supabase = createClient(
    "https://nzdvchpqyjratjehihld.supabase.co",
    "sb_publishable_4Mk6edtpcZHKDDhozciqkw_4NhifvKo"
);

// --------------------------------------------------
// HTML ELEMENTS & CACHING
// --------------------------------------------------

const button = document.getElementById("selectBtn");
const modal = document.getElementById("loadingModal");
const modalBox = document.querySelector(".modal-box");

// Cache the original loading state layout to safely reset it later without refreshing
const originalModalHTML = modalBox.innerHTML;

// Dynamic references that need re-binding upon modal reset
let progress = document.getElementById("progressBar");
let percent = document.getElementById("percentText");
let status = document.getElementById("statusText");
let modalIcon = document.getElementById("modalIcon");
let modalTitle = document.getElementById("modalTitle");

// Target modern multi-card selectors
const monumentCards = document.querySelectorAll(".monument-card");

// --------------------------------------------------
// STATE TRACKING & DICTIONARIES
// --------------------------------------------------

// Set the initial selected model based on which card has the "selected" class by default
let selectedModel = "eiffel";
const initialSelectedCard = document.querySelector(".monument-card.selected");
if (initialSelectedCard) {
    selectedModel = initialSelectedCard.dataset.model;
}

// Extensible lookup tables for scalable asset metadata management
const modelMetadata = {
    eiffel: { title: "Eiffel Tower Selected", icon: "🗼", displayName: "Eiffel Tower" },
    bigben: { title: "Big Ben Selected", icon: "🇬🇧", displayName: "Big Ben" },
    statue: { title: "Statue of Liberty Selected", icon: "🗽", displayName: "Statue of Liberty" },
    christ: { title: "Christ the Redeemer Selected", icon: "🇧🇷", displayName: "Christ the Redeemer" },
    arc: { title: "Arc de Triomphe Selected", icon: "🇫🇷", displayName: "Arc de Triomphe" },
    opera: { title: "Sydney Opera House Selected", icon: "🇦🇺", displayName: "Sydney Opera House" }
};

// --------------------------------------------------
// CARD CLICK EVENT HANDLERS
// --------------------------------------------------

monumentCards.forEach(card => {
    card.addEventListener("click", () => {
        // Remove class "selected" from every card
        monumentCards.forEach(c => c.classList.remove("selected"));
        
        // Add class "selected" to the clicked card
        card.classList.add("selected");
        
        // Remember selectedModel = clickedCard.dataset.model
        selectedModel = card.dataset.model;
    });
});

// --------------------------------------------------
// DISPLAY ACTION BUTTON TRIGGER
// --------------------------------------------------

button.addEventListener("click", async () => {

    // Dynamically update the loading modal title and icon based on the active selection lookup
    const metadata = modelMetadata[selectedModel] || { title: "Monument Selected", icon: "✨", displayName: "Monument" };
    if (modalTitle) modalTitle.innerHTML = metadata.title;
    if (modalIcon) modalIcon.innerHTML = metadata.icon;

    modal.classList.add("active");
    status.innerHTML = "Connecting to Holographic Display...";
    progress.style.width = "0%";
    percent.innerHTML = "0%";

    // --------------------------------------
    // SEND DYNAMIC MODEL TO SUPABASE
    // --------------------------------------

    const { error } = await supabase
        .from("display_state")
        .update({
            current_model: selectedModel
        })
        .eq("id", 1);

    if (error) {
        console.error("Supabase State Engine Broadcast Failure: ", error);
    }

    // --------------------------------------
    // ANIMATION & PROGRESS PIPELINE
    // --------------------------------------

    let value = 0;

    const timer = setInterval(() => {
        value += 2;
        progress.style.width = value + "%";
        percent.innerHTML = value + "%";

        if (value == 25) {
            status.innerHTML = "Connecting to Holographic Display...";
        }

        if (value == 55) {
            // Display structured formatting utilizing metadata lookup mappings seamlessly
            status.innerHTML = "Sending " + metadata.displayName + "...";
        }

        if (value == 80) {
            status.innerHTML = "Loading 3D Monument...";
        }

        if (value >= 100) {
            clearInterval(timer);
            progress.style.width = "100%";
            percent.innerHTML = "Complete";
            status.innerHTML = "✅ Projection Ready";

            setTimeout(() => {
                modalBox.innerHTML = `
                <div class="icon">🎉</div>
                <h2>Hologram Ready!</h2>
                <p class="guide">
                Please proceed to the hologram display.
                <br><br>
                Use your hand to rotate,
                zoom and interact.
                <br><br>
                Enjoy the experience.
                </p>
                <button id="continueBtn">
                Continue →
                </button>
                `;

                document
                    .getElementById("continueBtn")
                    .addEventListener("click", () => {
                        // Close modal immediately without refreshing the window
                        modal.classList.remove("active");
                        
                        // Restore original inner DOM components for subsequent runs
                        modalBox.innerHTML = originalModalHTML;
                        
                        // Re-bind the dynamic DOM element references
                        progress = document.getElementById("progressBar");
                        percent = document.getElementById("percentText");
                        status = document.getElementById("statusText");
                        modalIcon = document.getElementById("modalIcon");
                        modalTitle = document.getElementById("modalTitle");
                    });
            }, 1200);
        }
    }, 40);
});