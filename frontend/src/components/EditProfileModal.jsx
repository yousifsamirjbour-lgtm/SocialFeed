import React from 'react';
import Cropper from 'react-easy-crop';

const EditProfileModal = ({
  setShowEditProfileModal, handleEditProfileSubmit, editBio, setEditBio,
  imageSrc, setImageSrc, crop, setCrop, zoom, setZoom, onCropComplete,
  onFileChange, removePhoto, setRemovePhoto
}) => {
  return (
    <div className="modal-overlay" onClick={() => setShowEditProfileModal(false)}>
      <div className="modal-content edit-profile-content" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Profile</h3>
        <form onSubmit={handleEditProfileSubmit}>
          <div className="form-group">
            <label>Bio</label>
            <textarea 
              className="modern-textarea" value={editBio} onChange={(e) => setEditBio(e.target.value)}
              placeholder="Tell us about yourself..." rows="3"
            />
          </div>
          <div className="form-group">
            <label>Profile Picture</label>
            {imageSrc ? (
              <>
                <div className="crop-container">
                  <Cropper
                    image={imageSrc} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false}  
                    onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete}
                  />
                </div>
                <div className="slider-container">
                  <label>Zoom</label>
                  <input type="range" value={zoom} min={1} max={3} step={0.1} onChange={(e) => setZoom(Number(e.target.value))} />
                  <button type="button" className="text-btn" onClick={() => setImageSrc(null)}>Choose a different image</button>
                </div>
              </>
            ) : (
              <>
                <input type="file" id="profile-image-upload" accept="image/*" onChange={onFileChange} style={{ display: 'none' }} />
                <label htmlFor="profile-image-upload" className="custom-upload-btn">Choose an image</label>
                <button type="button" onClick={() => setRemovePhoto(true)} disabled={removePhoto} className={`remove-photo-btn ${removePhoto ? 'pending-removal' : ''}`}>
                  {removePhoto ? 'Photo will be removed on save' : 'Remove current photo'}
                </button>
              </>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="cancel-btn" onClick={() => { setShowEditProfileModal(false); setImageSrc(null); }}>Cancel</button>
            <button type="submit" className="modal-save-btn">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditProfileModal;