#!/usr/bin/env bash

# CO Costume Editor: starts the local server and opens the editor.
# Close this terminal window to stop it.

# Change to the directory where this script is located
cd "$(dirname "$0")" || exit

# Check if python3 is available
if ! command -v python3 &> /dev/null; then
    echo "Python 3 was not found. Please install it to continue."
    read -p "Press Enter to exit..."
    exit 1
fi

# Create a local virtual environment to bypass Bazzite's strict package manager rules
VENV_DIR=".venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Setting up a Python virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate the virtual environment
source "$VENV_DIR/bin/activate"

# Check if the required packages (Pillow, numpy) are installed
if ! python3 -c "import PIL, numpy" &> /dev/null; then
    echo "Installing the Python packages the editor needs (Pillow, numpy)..."
    python3 -m pip install --disable-pip-version-check -r requirements.txt

    # Verify the installation was successful
    if ! python3 -c "import PIL, numpy" &> /dev/null; then
        echo ""
        echo "The packages could not be installed. Check your internet connection."
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# Run the Python server, passing along any arguments (like --browser)
python3 serve.py --open "$@"
EXIT_CODE=$?

# Pause if the script crashes so you can read the error
if [ $EXIT_CODE -ne 0 ]; then
    echo "The server closed with an error."
    read -p "Press Enter to exit..."
fi
