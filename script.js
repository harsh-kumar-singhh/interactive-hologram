const button = document.getElementById("selectBtn");

const modal = document.getElementById("loadingModal");

const progress = document.getElementById("progressBar");

const percent = document.getElementById("percentText");

const status = document.getElementById("statusText");

button.addEventListener("click", () => {

    modal.classList.add("active");

    let value = 0;

    progress.style.width = "0%";
    percent.innerHTML = "0%";

    status.innerHTML = "Connecting to Holographic Display...";

    const timer = setInterval(() => {

        value += 2;

        progress.style.width = value + "%";
        percent.innerHTML = value + "%";

        if (value === 25) {
            status.innerHTML = "Connecting to Holographic Display...";
        }

        if (value === 55) {
            status.innerHTML = "Sending Eiffel Tower...";
        }

        if (value === 80) {
            status.innerHTML = "Loading 3D Monument...";
        }

        if (value >= 100) {

            clearInterval(timer);

            progress.style.width = "100%";

            status.innerHTML = "✅ Projection Ready";

            percent.innerHTML = "Complete";

            setTimeout(() => {

                document.querySelector(".modal-box").innerHTML = `

                    <div class="icon">🎉</div>

                    <h2>Hologram Ready!</h2>

                    <p class="guide">

                        Please proceed to the hologram display.
                        <br><br>

                        Use your hand to rotate,
                        zoom and interact with the monument.
                        <br><br>

                        Enjoy the experience!

                    </p>

                    <button id="continueBtn">

                        Continue →

                    </button>

                `;

                document
                    .getElementById("continueBtn")
                    .addEventListener("click", () => {

                        modal.classList.remove("active");

                        location.reload();

                    });

            }, 1200);

        }

    }, 40);

});