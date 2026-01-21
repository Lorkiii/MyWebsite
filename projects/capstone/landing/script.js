
document.addEventListener('DOMContentLoaded', function() {
const openMenu = document.querySelector("#menu-open-button");
const closeMenu = document.querySelector("#menu-close-button");
const overlay = document.querySelector(".menu-overlay");

// Function to open menu
function openMobileMenu() {
    document.body.classList.add("show-menu");
}

// Function to close menu
function closeMobileMenu() {
    document.body.classList.remove("show-menu");
}

// Open menu
openMenu.addEventListener("click", openMobileMenu);

// Close menu
closeMenu.addEventListener("click", closeMobileMenu);

// Close menu when clicking overlay
overlay.addEventListener("click", closeMobileMenu);

// Close menu when clicking on nav links (mobile only)
const navLinks = document.querySelectorAll(".nav_link a");
navLinks.forEach(link => {
    link.addEventListener("click", () => {
        // Close menu on mobile screens only
        if (window.innerWidth <= 800) {
            closeMobileMenu();
        }
    });
});

// Close menu on window resize if window becomes larger than mobile
window.addEventListener("resize", () => {
    if (window.innerWidth > 800) {
        closeMobileMenu();
    }
});

// for login button that will locate to login page
document.getElementById("loginbtn").addEventListener("click", function(event) {
    event.preventDefault(); // Prevents any default behavior (if it's inside a link or form)
    window.location.href = "/login/login.html"; // path for login
});

document.getElementById('applynow').addEventListener("click", function() {
    window.location.href = "/applicationform/tcfrom.html";
 
 });
});

    