import type { RequestWithAuth } from "./auth";

export const goodbye_frontend = async (request: RequestWithAuth) => new Response(`
        <html>
            <body>
                <h1>Cloud data deletion</h1>
                <p>You are logged in as ${request.auth.username} with provider ${request.auth.provider}.</p>

                <p>Press and hold the button below to confirm you really want to delete all of your cloud data. This action is irreversible.</p>

                <button id="delete_btn" style="background-color: red; color: white; padding: 10px; border: none; border-radius: 5px; cursor: pointer">
                    Hold to delete all cloud data
                    <progress id="progress" value="0" max="5" style="width: 100%; display: block; margin-top: 10px;"></progress>
                </button>

                <script>
                    const button = document.getElementById("delete_btn");
                    const progress = document.getElementById("progress");

                    let hold_timeout;
                    let hold_interval;
                    let hold_time = 0;

                    button.addEventListener("mousedown", () => {
                        hold_timeout = setTimeout(() => {
                            fetch("/me", { method: "DELETE" })
                                .then(response => {
                                    if (response.ok) {
                                        alert("All cloud data deleted successfully. Thanks for stopping by!");
                                        window.close();
                                    } else {
                                        alert("Failed to delete cloud data!");
                                        window.location.reload();
                                    }
                                })
                                .catch(() => {
                                    alert("An error occurred while deleting cloud data.");
                                });
                        }, 5000);

                        hold_interval = setInterval(() => {
                            hold_time += 100;
                            progress.value = hold_time / 1000;
                        }, 100);
                    });

                    button.addEventListener("mouseup", () => {
                        clearTimeout(hold_timeout);
                        clearInterval(hold_interval);
                        hold_time = 0;
                        progress.value = 0;
                    });
                </script>
            </body>
        </html>
    `,
    { headers: { "Content-Type": "text/html" } }
);
