import React, { useEffect, useState } from "react";
import PageShell from "../components/PageShell";
import { Building2, Shield, Save } from "lucide-react";

const ProfileSettings = ({
  currentUser,
  offices,
  onUpdateProfile,
  onNotify,
}) => {
  const [formData, setFormData] = useState({
    fname: "",
    lname: "",
    mname: "",
    username: "",
    password: "",
    confirmPassword: "",
  });
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setFormData({
      fname: currentUser.fname || "",
      lname: currentUser.lname || "",
      mname: currentUser.mname || "",
      username: currentUser.username || "",
      password: "",
      confirmPassword: "",
    });
    setFormError("");
  }, [currentUser]);

  const getOfficeName = (officeId) => {
    const office = offices.find((item) => item.id === officeId);
    return office ? office.name : "Unknown Office";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    const payload = {
      fname: formData.fname.trim(),
      lname: formData.lname.trim(),
      mname: formData.mname.trim(),
      username: formData.username.trim(),
    };

    if (!payload.fname || !payload.lname || !payload.username) {
      setFormError("First name, last name, and username are required.");
      return;
    }

    const nextPassword = formData.password.trim();
    const confirmPassword = formData.confirmPassword.trim();

    if (nextPassword || confirmPassword) {
      if (nextPassword.length < 6) {
        setFormError("New password must be at least 6 characters long.");
        return;
      }
      if (nextPassword !== confirmPassword) {
        setFormError("New password and confirmation do not match.");
        return;
      }
      payload.password = nextPassword;
    }

    setIsSaving(true);
    try {
      const saved = await onUpdateProfile(payload);
      if (!saved) return;

      setFormData((prev) => ({
        ...prev,
        password: "",
        confirmPassword: "",
      }));

      onNotify?.({
        type: "success",
        title: "Profile updated",
        message: "Your account details were saved successfully.",
      });
    } catch (error) {
      setFormError(error.message || "Unable to save profile changes.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageShell
      header={
        <div className="page-header">
          <div className="page-header-left">
            <h1>Profile Settings</h1>
            <p>Update your account details and password.</p>
          </div>
        </div>
      }
    >
      <div className="profile-settings-page">
        <div className="profile-settings-layout">
          <aside className="card profile-settings-side">
            <div className="profile-settings-avatar user-avatar">
              {currentUser?.fname?.[0] || "?"}
              {currentUser?.lname?.[0] || ""}
            </div>
            <h2 className="profile-settings-name">
              {currentUser?.fname} {currentUser?.mname || ""} {currentUser?.lname}
            </h2>
            <p className="profile-settings-meta">
              <Shield size={14} />
              {currentUser?.role || "User"}
            </p>
            <p className="profile-settings-meta">
              <Building2 size={14} />
              {getOfficeName(currentUser?.officeId)}
            </p>
          </aside>

          <div className="card profile-settings-card">
            <form className="profile-settings-form" onSubmit={handleSubmit}>
            {formError && (
              <div className="profile-settings-error">{formError}</div>
            )}

            <div className="form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="profile-fname">
                  First Name *
                </label>
                <input
                  id="profile-fname"
                  className="form-input"
                  type="text"
                  value={formData.fname}
                  onChange={(event) =>
                    setFormData({ ...formData, fname: event.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="profile-lname">
                  Last Name *
                </label>
                <input
                  id="profile-lname"
                  className="form-input"
                  type="text"
                  value={formData.lname}
                  onChange={(event) =>
                    setFormData({ ...formData, lname: event.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="profile-mname">
                  Middle Name
                </label>
                <input
                  id="profile-mname"
                  className="form-input"
                  type="text"
                  value={formData.mname}
                  onChange={(event) =>
                    setFormData({ ...formData, mname: event.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="profile-username">
                  Username *
                </label>
                <input
                  id="profile-username"
                  className="form-input"
                  type="text"
                  value={formData.username}
                  onChange={(event) =>
                    setFormData({ ...formData, username: event.target.value })
                  }
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="profile-settings-section">
              <h3>Change Password</h3>
              <p className="field-hint">
                Leave blank to keep your current password.
              </p>

              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="profile-password">
                    New Password
                  </label>
                  <input
                    id="profile-password"
                    className="form-input"
                    type="password"
                    value={formData.password}
                    onChange={(event) =>
                      setFormData({ ...formData, password: event.target.value })
                    }
                    autoComplete="new-password"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="profile-confirm-password">
                    Confirm New Password
                  </label>
                  <input
                    id="profile-confirm-password"
                    className="form-input"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        confirmPassword: event.target.value,
                      })
                    }
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>

            <div className="profile-settings-readonly">
              <div className="profile-settings-readonly-item">
                <span className="form-label">Role</span>
                <span>{currentUser?.role || "—"}</span>
              </div>
              <div className="profile-settings-readonly-item">
                <span className="form-label">Office</span>
                <span>{getOfficeName(currentUser?.officeId)}</span>
              </div>
            </div>

            <div className="profile-settings-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving}
              >
                <Save size={16} />
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
            </form>
          </div>
        </div>
      </div>
    </PageShell>
  );
};

export default ProfileSettings;
